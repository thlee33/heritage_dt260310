Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIxZTBiMzA2OS04ZTMxLTQ1NjMtYjU5OC1lMWVlMWViZmI1MjgiLCJpZCI6MzA1NywiaWF0IjoxNzY5NTc0NzY3fQ.2t_Z8vHd3k6LbTHlxTZj76HiAHsCvsxms1lkM80nOB4';


// 1. Initialize Cesium Viewer
const viewer = new Cesium.Viewer('cesiumContainer', {
    //imageryProvider: new Cesium.OpenStreetMapImageryProvider({
    //    url : 'https://a.tile.openstreetmap.org/'
    //}),
	terrain: Cesium.Terrain.fromWorldTerrain(), // 3D 지형 위에 3D Mesh를 올리기 위해 지형 활성화
    //terrainProvider: Cesium.createWorldTerrain(), // Since it's an older version of Cesium, or if async, we can set via promise below. But wait, let's use the standard from prototype.
    animation: false,
    timeline: false,
    navigationHelpButton: false,
    baseLayerPicker: false,
    homeButton: false,
    geocoder: false,
    sceneModePicker: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false
});

viewer.scene.globe.show = true;

// Add OSM Buildings
Cesium.createOsmBuildingsAsync().then(buildingsTileset => {
    viewer.scene.primitives.add(buildingsTileset);
}).catch(err => console.error("OSM Buildings error:", err));

// Remove credit container for cleaner UI (Optional, but good for premium feel)
viewer.cesiumWidget.creditContainer.style.display = 'none';



let globalGraphData = null;
let currentGraph = null;

// 2. Load Graph Data (nodes & edges)
fetch('data/graph_data.json')
    .then(r => r.json())
    .then(data => {
        globalGraphData = data;
        console.log("Graph Data Loaded", data.nodes.length, "nodes");
    });

// 3. Load Spatial Data (GeoJSON)
Cesium.GeoJsonDataSource.load('data/legacy.geojson', {
    stroke: Cesium.Color.fromCssColorString('#4facfe'),
    fill: Cesium.Color.fromCssColorString('#4facfe').withAlpha(0.5),
    strokeWidth: 3,
    markerSymbol: 'monument',
    markerColor: Cesium.Color.fromCssColorString('#4facfe')
}).then(dataSource => {
    viewer.dataSources.add(dataSource);
    
    // Zoom to Korea roughly
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(127.5, 36.5, 800000.0),
        duration: 2.0
    });
});

// 4. Handle Clicks on Map
const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction(function (click) {
    const pickedObject = viewer.scene.pick(click.position);
    
    if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties) {
        const props = pickedObject.id.properties;
        const hId = props.id ? props.id.getValue() : null;
        const name = props.name ? props.name.getValue() : 'Unknown';
        const era = props.era ? props.era.getValue() : '-';
        const category = props.category ? props.category.getValue() : '-';
        const location = props.location ? props.location.getValue() : '-';

        showPanel(hId, name, era, category, location);
    } else {
        hidePanel();
    }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// 5. Panel & Graph Logic
const panel = document.getElementById('graphPanel');
const closeBtn = document.getElementById('closePanelBtn');
const graphContainer = document.getElementById('graphContainer');

closeBtn.addEventListener('click', hidePanel);

function hidePanel() {
    panel.classList.add('hidden');
}

function updatePanelInfo(name, era, category, location) {
    document.getElementById('selectedName').textContent = name;
    document.getElementById('selectedEra').textContent = era || '-';
    document.getElementById('selectedCategory').textContent = category || '-';
    document.getElementById('selectedLocation').textContent = location || '-';
    panel.classList.remove('hidden');
}

function showPanel(id, name, era, category, location) {
    updatePanelInfo(name, era, category, location);
    
    if (globalGraphData && id) {
        renderGraphFor(id);
    }
}

function renderGraphFor(heritageId) {
    if (!globalGraphData) return;

    // Filter connections (1 hop)
    const links = [];
    const nodeIds = new Set();
    nodeIds.add(heritageId);

    globalGraphData.links.forEach(l => {
        // ForceGraph modifies source/target to objects, so check both string/obj
        const sId = typeof l.source === 'object' ? l.source.id : l.source;
        const tId = typeof l.target === 'object' ? l.target.id : l.target;

        if (sId === heritageId || tId === heritageId) {
            links.push(Object.assign({}, l)); // shallow copy
            nodeIds.add(sId);
            nodeIds.add(tId);
        }
    });

    const nodes = globalGraphData.nodes
        .filter(n => nodeIds.has(n.id))
        .map(n => Object.assign({}, n));

    const gData = { nodes, links };

    if (currentGraph) {
        // Update existing graph
        currentGraph.graphData(gData);
    } else {
        // Init new graph
        const width = graphContainer.clientWidth;
        const height = graphContainer.clientHeight;

        currentGraph = ForceGraph()(graphContainer)
            .width(width)
            .height(height)
            .backgroundColor('rgba(0,0,0,0)')
            .graphData(gData)
            .nodeId('id')
            .nodeLabel('name')
            .nodeColor(n => {
                if(n.id === heritageId) return '#ff3b30'; // Main Node
                if(n.group === 'Category') return '#4facfe';
                if(n.group === 'Era') return '#ffcc00';
                if(n.group === 'Location') return '#34c759';
                return '#ffffff';
            })
            .nodeRelSize(6)
            .linkColor(() => 'rgba(255,255,255,0.4)')
            .linkWidth(2)
            .onNodeClick(node => {
                if(node && node.id) {
                    expandGraphWith(node);
                }
            });
            
        currentGraph.d3Force('charge').strength(-200);
        currentGraph.d3Force('link').distance(75);
            
        // Resize observer
        const resizeObserver = new ResizeObserver(() => {
            if (currentGraph) {
                currentGraph.width(graphContainer.clientWidth);
                currentGraph.height(graphContainer.clientHeight);
            }
        });
        resizeObserver.observe(graphContainer);
    }
}

function expandGraphWith(clickedNode) {
    if (!globalGraphData || !currentGraph) return;

    const clickedNodeId = clickedNode.id;

    // Check if clicked node is a Heritage
    if (clickedNode.group === 'Heritage') {
        // 1. Update Panel
        updatePanelInfo(clickedNode.name, clickedNode.era, clickedNode.category, clickedNode.location);
        
        // 2. Fly camera to entity
        if (viewer.dataSources.length > 0) {
            const ds = viewer.dataSources.get(0);
            const targetEntity = ds.entities.values.find(e => {
                if (e.properties && e.properties.id) {
                    return e.properties.id.getValue() === clickedNodeId;
                }
                return false;
            });
            if (targetEntity) {
                viewer.flyTo(targetEntity, {
                    duration: 1.5,
                    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 1800)
                });
            } else {
                console.log("Entity not found for flyTo:", clickedNodeId);
            }
        }
        
        // 3. Re-center graph for this new Heritage node
        renderGraphFor(clickedNodeId);
        return; // Early return so we don't append nodes below
    }

    // Get current grap data
    const { nodes: currentNodes, links: currentLinks } = currentGraph.graphData();
    
    // Find new connections for the clicked node
    const newLinks = [];
    const newNodeIds = new Set();
    
    globalGraphData.links.forEach(l => {
        const sId = typeof l.source === 'object' ? l.source.id : l.source;
        const tId = typeof l.target === 'object' ? l.target.id : l.target;

        if (sId === clickedNodeId || tId === clickedNodeId) {
            // Check if link already exists
            const exists = currentLinks.some(cl => 
                (typeof cl.source === 'object' ? cl.source.id : cl.source) === sId && 
                (typeof cl.target === 'object' ? cl.target.id : cl.target) === tId
            );
            
            if (!exists) {
                newLinks.push(Object.assign({}, l));
                
                // Track node IDs to add
                const existS = currentNodes.some(cn => cn.id === sId);
                if(!existS) newNodeIds.add(sId);
                
                const existT = currentNodes.some(cn => cn.id === tId);
                if(!existT) newNodeIds.add(tId);
            }
        }
    });

    if (newLinks.length === 0 && newNodeIds.size === 0) return; // Nothing new to add

    const newNodes = globalGraphData.nodes
        .filter(n => newNodeIds.has(n.id))
        .map(n => Object.assign({}, n));

    // Append to graph
    currentGraph.graphData({
        nodes: [...currentNodes, ...newNodes],
        links: [...currentLinks, ...newLinks]
    });
}
