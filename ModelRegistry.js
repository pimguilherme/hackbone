define(function (require) {

    var log = function () {
        console.log.call(console, '[Registry] ' + m, Array.prototype.slice.call(arguments, 1));
    }

    // Model Registry
    // Here we store all models reference so they don't have to be duplicated,
    // based on the idAttribute
    return {
        _instances:{},

        // Adds a new model to the registry
        add:function (model) {
            var self = this
            // Initialize the Model's registry
            if (!this._instances[model.name]) this._instances[model.name] = {};

            // Add this model to the registry immediately
            if (model.id) {
                this._set(model.name, model.id, model);
            }
            // Wait until we have an id
            else {
                var waitForId = function () {
                    self._set(model.name, model.id, model);
                    model.off('change:_id', waitForId);
                };
                model.on('change:_id', waitForId);
            }

            // Wait for its destruction for removal from registry
            var waitForDestroy = function () {
                self.remove(model);
                model.off('destroy', waitForDestroy); // just to be sure we do our part
            }
            model.on('destroy', waitForDestroy);
        },

        // Simply sets the new registry model
        _set:function (modelName, id, model) {
            if (this._instances[modelName][id]) {
                log('Overwriting model', modelName, id, model);
            }
            this._instances[modelName][id] = model;
        },

        // Removes a model or an id from the registry
        remove:function (modelName, id) {
            if (!id) {
                id = modelName.id;
                modelName = modelName.name;
            }
            if (id && this._instances[modelName]) {
                delete this._instances[modelName][id];
            }
        },

        // Returns a model from the registry
        fetch:function (modelName, id) {
            return this._instances[modelName] && this._instances[modelName][id];
        }
    }
});