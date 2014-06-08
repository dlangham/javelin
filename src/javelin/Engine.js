Javelin.Engine = function(registry, environment, config) {
    environment.setEngine(this);

    //this should persist
    this.registry = registry;
    this.environment = environment;
    this.loader = environment.getLoader();
    this.config = config;
    this.debug = config.debug || false;
    this.targetFps = config.stepsPerSecond || 1000/30;
    this.initialized = false;
    this.listeners = {};

    //everything else can be reset
    this.reset();
};

Javelin.Engine.prototype.reset = function() {
    //general state
    this.running = false;
    this.updating = false;
    this.isRunningSlowly = false;
    this.currentFps = 0.0;
    this.lastUpdateTimeTaken = 0.0;

    //game object
    this.gos = [];
    this.lastGoId = 0;
    this.createdGos = [];
    this.destroyedGos = [];

    //timing
    this.stepId = 0;
    this.time = new Date().getTime();
    this.prevTime = 0.0;
    this.deltaTime = 0.0;

    //scene
    this.sceneDefinition = {};
    this.plugins = {};
    this.currentScene = false;

    //configure the loader
    //TODO: think of better way to do this, possibly require it
    //via the environment
    if (this.config.loader) {
        this.loader = new Javelin.AssetLoader(this.config.loader.assetUrl || '');
    }

};

/* Managing Game Objects */

Javelin.Engine.prototype.getEntityById = function(id) {
    var l = this.gos.length;
    for (var i = 0; i < l; i++) {
        if (this.gos[i].id === id) {
            return this.gos[i];
        }
    }

    return false;
};

Javelin.Engine.prototype.callEntities = function(callback) {
    var ents = this.gos, l = ents.length;
    for(var i = 0; i < l; i++) {
        var ent = ents[i];
        if (ent.enabled) {
            callback(ent);
        }
    }
};

Javelin.Engine.prototype.callRootEntities = function(callback) {
    var ents = this.gos, l = ents.length;
    for(var i = 0; i < l; i++) {
        var ent = ents[i];
        if (ent.enabled && ent.isRoot()) {
            callback(ent);
        }
    }
};

Javelin.Engine.prototype.instantiate = function(prefab) {
    return this.instantiateEntity(this.registry.getPrefab(prefab));
};

Javelin.Engine.prototype.instantiateEntity = function(def, isNestedCall) {
    var ent;

    //instantiate game object
    if (def.fromPrefab) {
        //it's not really nested, but we say it is to avoid this call
        //adding dupliate copies of the object
        ent = this.instantiateEntity(this.registry.getPrefab(def.fromPrefab), true);
    } else {
        ent = new Javelin.Entity();
        ent.layer = def.layer || 'default';
        ent.name = def.name || 'Anonymous';
        ent.tags = def.tags || [];
        ent.engine = this;
    }

    if (ent.id === -1) {
        ent.setId(++this.lastGoId);
    }

    //add required components w/ values
    if (def.components) {
        for (var key in def.components) {
            var c = this.addComponentToEntity(ent, key);
            c.$unserialize(def.components[key]);
        }
    }

    //instantiate children
    if (def.children) {
        var l = def.children.length;
        for (var i = 0; i < l; i++) {
            //TODO: should this be optimized?
            //Should hierarchy events be fired during an instantiation?
            ent.addChild(this.instantiateEntity(def.children[i], true));
        }
    }

    if (!isNestedCall) {
        this.__addGameObject(ent);
    }

    return ent;
};

Javelin.Engine.prototype.addComponentToEntity = function(ent, name) {
    if (ent.hasComponent(name)) {
        return ent.get(name);
    }

    //add any required components first
    var def = this.registry.getComponent(name);
    var reqs = def.computedRequirements;
    var l = reqs.length;

    for (var i = 0; i < l; i++) {
        this.addComponentToEntity(ent, reqs[i]);
    }

    var comp = new Javelin.Component(name);
    comp.$id = ent.id;
    def.handler.call(comp, ent, this);

    ent.setComponent(name, comp);

    return comp;
};

Javelin.Engine.prototype.__addGameObject = function(go) {
    if (this.updating && go.isRoot()) {
        this.createdGos.push(go);
    } else {
        this.gos.push(go);

        this.callPlugins('$onEntityCreate', [go]);

        if (go.children.length) {
            for (var i in go.children) {
                this.__addGameObject(go.children[i]);
            }
        }

        if (go.isRoot()) {
            go.enable();

            go.broadcast('entity.create');

            this.callPlugins('$onPrefabCreate', [go]);
        }
    }
};

//destroy an object (if the engine is updating, it will be destroyed after the update is done)
Javelin.Engine.prototype.destroy = function(go, destroyingNested) {
    if (this.updating) {
        this.destroyedGos.push(go);
    } else {
        var i;

        if (!destroyingNested) {

            this.callPlugins('$onPrefabDestroy', [go]);

            //notify destroy callbacks
            go.broadcast('entity.destroy');
        }

        //destroy children first
        if(go.children) {
            //copy into separate array so we can abandon now
            var children = [];
            for (i in go.children) {
                children.push(go.children[i]);
            }
            go.abandonChildren();

            //destroy children
            for (i in children) {
                this.destroy(children[i], true);
            }
        }

        //notify plugins
        this.callPlugins('$onEntityDestroy', [go]);

        //make sure this object is detached from any parents,
        //because we abandoned and deleted children already,
        //this should only be the case if this go is a child of
        //another object that is NOT being deleted
        if (go.parent) {
            go.parent.removeChild(go);
        }

        //remove references
        go.setId(-1);
        go.engine = null;

        //remove from engine
        var index = this.gos.indexOf(go);
        this.gos.splice(index, 1);
    }
};

/* Game Loop & State */

//This must be called before loading and running scenes
Javelin.Engine.prototype.initialize = function() {
    this.registry.optimize();
    this.initialized = true;
};

Javelin.Engine.prototype.run = function() {
    this.running = true;
    this.environment.run(this.targetFps);
};

Javelin.Engine.prototype.stop = function(callback) {
    this.environment.stop(callback);
    this.running = false;
};

Javelin.Engine.prototype.step = function() {
    this.updating = true;
    this.stepId++;
    this.prevStepTime = this.time;
    this.time = new Date().getTime();
    this.deltaTime = (this.time - this.prevStepTime) * 0.001;

    //some plugins process before GO udpates
    this.callPlugins('$onPreUpdate', [this.deltaTime]);

    this.updateGameObjects(this.deltaTime);

    //some process after
    this.callPlugins('$onPostUpdate', [this.deltaTime]);
    this.updating = false;

    //clean now, so next step contains the modifications
    //from this step
    this.cleanupStep();

    this.lastUpdateTimeTaken = new Date().getTime() - this.time;

    if(this.lastUpdateTimeTaken > this.targetFps) {
        this.isRunningSlowly = true;
    } else {
        this.isRunningSlowly = false;
    }

};

Javelin.Engine.prototype.stats = function() {
    return {
        entities: this.gos.length,
        lastUpdateTime: this.lastUpdateTimeTaken + ' ms',
        targetFPS: Math.floor(this.targetFps),
        deltaTime: this.deltaTime + ' ms'
    };
};

Javelin.Engine.prototype.updateGameObjects = function(deltaTime) {
    var l = this.gos.length;
    for (var i = 0; i < l; i++) {
        var go = this.gos[i];

        if (go.enabled && go.isRoot()) {
            go.broadcast('engine.update', [deltaTime]);
        }
    }
};

Javelin.Engine.prototype.cleanupStep = function() {
    var lc = this.createdGos.length;
    var ld = this.destroyedGos.length;
    var i;

    if (lc) {
        for (i = 0; i < lc; i++) {
            this.__addGameObject(this.createdGos[i]);
        }
    }

    if (ld) {
        for (i = 0; i < ld; i++) {
            this.destroy(this.destroyedGos[i]);
        }
    }

    this.createdGos = [];
    this.destroyedGos = [];
};

Javelin.Engine.prototype.callPlugins = function(method, args) {
    args = args || [];
    for (var name in this.plugins) {
        var p = this.plugins[name];
        if (p.$enabled) {
            p[method].apply(p, args);
        }
    }
};

//this should act as a manual trigger for garbage collection
Javelin.Engine.prototype.flush = function() {
    //internal flushing?
    //remove references, if I ever implement entity/component pools - clean them

    //notify plugins of flush, they should remove any references in order to force
    //garbage collection
    this.callPlugins('$onFlush');
};

/* Scene management */

Javelin.Engine.prototype.getCurrentScene = function() {
    return this.currentScene;
};

Javelin.Engine.prototype.loadScene = function(name, callback) {
    //don't load a scene if it's still running - shutdown first
    if (this.running) {
        var engine = this;
        this.stop(function() {
            engine.unloadScene();
            engine.loadScene(name, callback);
        });

        return;
    }

    this.reset();

    if(!this.initialized) {
        this.initialize();
    }

    var scene = this.registry.getScene(name);

    if(!scene) {
        throw new Error("Tried loading unregistered scene: " + name);
    }

    this.sceneDefinition = scene;
    this.currentScene = name;

    //load plugins defined in scene - otherwise, check main config
    var alias;
    if (scene.plugins) {
        for (alias in scene.plugins) {
            var config = !Javelin.isEmpty(scene.plugins[alias]) ? scene.plugins[alias] : {};
            this.loadPlugin(alias, config);
        }
    } else if (this.config.plugins) {
        for (alias in this.config.plugins) {
            this.loadPlugin(alias, this.config.plugins[alias]);
        }
    }

    //TODO: load required assets, should be done before entities are instantiated

    //instantiate any entities
    if (scene.entities) {
        for (var i = 0; i < scene.entities.length; i++) {
            if (Javelin.isString(scene.entities[i])) {
                this.instantiate(scene.entities[i]);
            } else {
                this.instantiateEntity(scene.entities[i]);
            }
        }
    }

    this.callPlugins('$onSceneLoaded');

    if (callback) {
        callback();
    } else {
        this.run();
    }
};

Javelin.Engine.prototype.unloadScene = function() {
    this.unloadPlugins();
    this.reset();
};

/* Asset management */

Javelin.Engine.prototype.loadAsset = function(path, callback) {
    return this.loader.loadAsset(path, callback);
};

Javelin.Engine.prototype.loadAssets = function(arr, callback) {
    return this.loader.loadAssets(arr, callback);
};

Javelin.Engine.prototype.getAsset = function(path) {
    return this.loader.getAsset(path);
};

/* Plugin Management */
Javelin.Engine.prototype.loadPlugin = function(name, config) {
    if (this.plugins[name]) {
        return;
    }

    var def = this.registry.getPlugin(name);
    if (!def) {
        throw new Error("An unknown plugin [" + name + "] was requested.");
    }

    if (Javelin.isEmpty(config)) {
        if (this.config && this.config.plugins && this.config.plugins[name]) {
            config = this.config.plugins[name];
        } else {
            config = def.defaults || {};
        }
    }

    var plugin = new Javelin.Plugin(name, this);

    def.handler.call(plugin, config);
    this.plugins[plugin.$name] = plugin;
    plugin.$onLoad();
};

Javelin.Engine.prototype.unloadPlugin = function(name) {
    var p = this.getPlugin(name);
    if(p) {
        p.$onUnload();
        this.plugins[name] = null;
    }
};

Javelin.Engine.prototype.unloadPlugins = function() {
    for (var alias in this.plugins) {
        this.unloadPlugin(alias);
    }
};

Javelin.Engine.prototype.getPlugin = function(alias) {
    return this.plugins[alias] || false;
};

/**
 * Register a listener for the engine.  Note that entities, components
 * and plugins should *never* use this to register listeners.  This is
 * for use only by elements that exist outside the context of the engine
 * and the currently executing scene.
 */
Javelin.Engine.prototype.on = function(event, callback) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(callback);
};

/**
 * Dispatches an event to listeners registered at the engine level.  Generally these
 * are listeners that are registered outside the context of a scene - maybe by
 * other elements on the page in which the game appears.
 */
Javelin.Engine.prototype.emit = function(event, data) {
    var listeners = this.listeners[event] || [];
    for (var i = 0; i < listeners.length; i++) {
        listeners[i].apply(null, data);
    }
};

/**
 * Broadcasts an event to entities in the scene.  Mechanisms outside the context
 * of the game can use this to communicate with entities acting in the scene.
 */
Javelin.Engine.prototype.broadcast = function(event, args) {
    //emit on self first
    this.emit(event, args);

    //then broadcast to root game objects
    for (var i = 0; i < this.gos.length; i++) {
        if (this.gos[i].isRoot()) {
            this.gos[i].broadcast(event, args);
        }
    }
};
