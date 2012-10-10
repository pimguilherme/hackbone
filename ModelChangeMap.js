define(function () {
    // Object responsible for binding to a model supporting
    // nested change events
    //
    // Support for propagated collection add/remove/reset events as
    // as 'change:' event in a model's property is also added.
    //
    return (function (Model, Collection) {

        // References to original methods
        var on = Model.prototype.on
            , off = Model.prototype.off
        // Helpers
            , isNestedChange = function (name) { return name.substring(0, 7) == 'change:' && ~name.indexOf('.'); }
            , isAttrChange = function (name) { return name.substring(0, 7) == 'change:' }
            , isModel = function (v) { return v && v instanceof Model }
            , isCollection = function (v) { return v && v instanceof Collection }
            , callbackAttr = function (obj, path) {
                return '__cbmap_' + (obj.cid) + ':' + path;
            }
            , getListenerIdentifier = function (obj, path) { return obj.cid + '@' + path; }
            ;

        var ModelChangeMap = function (model, path, callback) {
            this.callback = callback;
            this.model = model;
            this.names = path.split('.');
            this.listeners = {};
        };

        // Returns either a new map uniquely for the callback or the existing map
        ModelChangeMap.getCallbackMap = function (callback, model, path) {
            var key = callbackAttr(model, path);
            if (callback[key]) return callback[key];
            return callback[key] = new ModelChangeMap(model, path, callback);
        }

        // Returns, if it exists, the callback map, and then detaches it
        // from the callback
        ModelChangeMap.popCallbackMap = function (callback, model, path) {
            var key = callbackAttr(model, path)
                , map = callback[key]
                ;
            delete callback[key];
            return map;
        }

        ModelChangeMap.prototype = {
            // Model to which this map belongs to
            model:null,
            // Array of path names to bind to, from the starting model
            names:null,
            // References to all listeners created by this subscription
            listeners:null,
            // Creates a callback to listen for `change` events on the given model
            // and then triggers the subscription callback. The value passed to the
            // subscription callback is, if `valuePath` is set, the product of
            // the new value set on the changing model traversed to `valuePath`;
            // e.g. model.get(valuePath)
            //
            // If `rebuild` is set, then after the callback is executed, all the bindings
            // TODO will be rebuilt from the subscription model and up.
            // TODO implement change events on nested objects (profilePicture = {small: '...'})
            //
            bind:function (model, changePath, valuePath, rebuild) {
                var self = this
                    , id = getListenerIdentifier(model, changePath + '@' + valuePath);
                if (this.listeners[id]) return;
                this.listeners[id] = [];

                var fn = function (m, v) {
                    self.callback.call(m, m, valuePath ? (isModel(v) ? v.get(valuePath) : null) : v);
                    if (rebuild) self.buildBindings();
                }
                on.call(model, 'change:' + changePath, fn);
                this.listeners[id].push({ obj:model, ev:'change:' + changePath, fn:fn });
            },

            // Wrapper to keep reference of listeners
            _bindToCollection:function (col) {
                var self = this
                    , id = 'collection';
                if (this.listeners[id]) return;
                this.listeners[id] = [];

                on.call(col, 'add', this.callback);
                on.call(col, 'remove', this.callback);
                on.call(col, 'reset', this.callback);
                this.listeners[id].push({ obj:col, ev:'add', fn:this.callback });
                this.listeners[id].push({ obj:col, ev:'remove', fn:this.callback });
                this.listeners[id].push({ obj:col, ev:'reset', fn:this.callback });
            },

            // Removes all model `change` event listeners connected to this subscription
            clearBindings:function () {
                var l;
                for (var id in this.listeners) {
                    while (l = this.listeners[id].shift()) {
                        off.call(l.obj, l.ev, l.fn);
                    }
                }
                this.listeners = {};
            },

            // Builds all bindings from the subscription model
            buildBindings:function () {
                this.clearBindings();
                var names = this.names.slice(0)
                    , name
                    , currentName = null
                    , model = this.model
                    , value = model
                    ;

                // We must loop through all models in the nested path
                while (value && (name = names.shift())) {
                    value = isModel(value) ? value.attributes[name] : value[name];
                    currentName = currentName ? (currentName + '.' + name) : name;
                    // And then subscribe to the Model with a callback
                    // that updates subscriptions each time the property changes,
                    // removing its old handlers and adding new ones
                    if (isModel(value) && names.length) {
                        this.bind(model, currentName, names.join('.'), true);
                        model = value;
                        currentName = null;
                    }
                }

                // If we have any remaining name, it means there's a property
                // we should bind to
                if (currentName) {
                    // If we still have names at this point, it means we have found a
                    // null value and should rebuild the bindings if the last bound model
                    // changes
                    this.bind(model, currentName, names.join('.'), names.length > 0 || isCollection(value));
                    if (isCollection(value)) {
                        this._bindToCollection(value);
                    }
                }
            },

            // Removes this map from the callback, without any checks
            remove:function () {
                delete this.callback[callbackAttr(this.model, this.names.join('.'))];
            }
        };

        // Possibility to subscribe to nested changes
        Model.prototype.on = function (name, callback) {
            if (!isAttrChange(name)) {
                return on.apply(this, arguments);
            }
            name = name.substring(7);
            // Subscriptions mappings
            var map = ModelChangeMap.getCallbackMap(callback, this, name);
            map.buildBindings();
            return map;
        }

        Model.prototype.off = function (name, callback) {
            if (!isAttrChange(name)) {
                return off.apply(this, arguments)
            }
            var map = ModelChangeMap.popCallbackMap(callback, this, name.substring(7))
            if (!map) return;
            map.clearBindings();
        }

        return ModelChangeMap;

    });
})