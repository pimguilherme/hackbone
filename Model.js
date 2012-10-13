define(function (require) {

    var _ = require('underscore')
        , config = require('config')
        , apiConfig = require('config').api
//    // Local
        , Events = require('./Events')
        , ModelChangeMap = require('./ModelChangeMap')
        , HashSanidator = require('./HashSanidator')
        , Hackbone = require('./Hackbone')
        , Utils = require('./Utils')


    var error = Utils.scopedError('Model')

    // Create a new model, with defined attributes. A client id (`cid`)
    // is automatically generated and assigned for you.
    var Model = function (attributes) {
        var defaults;
        attributes || (attributes = {});
        if (defaults = Utils.getValue(this, 'defaults')) {
            attributes = _.extend({}, defaults, attributes);
        }

        this.attributes = {};
        this.sanidator = new HashSanidator(this.attributes);
        this._escapedAttributes = {};
        this.cid = _.uniqueId('c');
        this.changed = {};
        this._silent = {};
        this._pending = {};
        this.set(attributes, {silent:true});
        // Reset change tracking.
        this.changed = {};
        this._silent = {};
        this._pending = {};
        this._previousAttributes = _.clone(this.attributes);
        this.initialize.apply(this, arguments);
    };

    Model.prototype = {

        // A hash of attributes whose current and previous value differ.
        changed:null,

        // A hash of attributes that have silently changed since the last time
        // `change` was called.  Will become pending attributes on the next call.
        _silent:null,

        // A hash of attributes that have changed since the last `'change'` event
        // began.
        _pending:null,

        // The default name for the JSON `id` attribute is `"id"`. MongoDB and
        // CouchDB users may want to set this to `"_id"`.
        idAttribute:'_id',

        // Initialize is an empty function by default. Override it with your own
        // initialization logic.
        initialize:function () {},

        // Returns a representation of the model for serialization
        // By default we will not serialize full models on association, we'll rather just
        // send its _id, or undefined if it's null
        //
        // Attributes starting with '-' are completely ignored
        toJSON:function () {
            var attrs = {};
            for (var name in this.attributes) {
                if (name[0] == '-') continue;
                if (this.attributes[name] instanceof Model) {
                    attrs[name] = this.attributes[name].id || this.attributes[name].toJSON()
                } else if (this.attributes[name] instanceof Hackbone.Collection) {
                    attrs[name] = this.attributes[name].toJSON()
                } else {
                    attrs[name] = this.attributes[name]
                }
            }
            return attrs;
        },

        // Get the value of an attribute, possibly nested
        // e.g. model.get('submodel.objProperty.property')
        get:function (path) {
            var names = path.split('.')
                , name
                , value = this.attributes[names.shift()]
                ;
            while (value && (name = names.shift())) {
                value = value instanceof Model ? value.attributes[name] : value[name];
            }
            return value;
        },

        // Get the HTML-escaped value of an attribute.
        escape:function (attr) {
            var html;
            if (html = this._escapedAttributes[attr]) return html;
            var val = this.get(attr);
            return this._escapedAttributes[attr] = _.escape(val == null ? '' : '' + val);
        },

        // Returns `true` if the attribute contains a value that is not null
        // or undefined.
        has:function (attr) {
            return this.get(attr) != null;
        },

        // Set a hash of model attributes on the object, firing `"change"` unless
        // you choose to silence it.
        set:function (key, value, options) {
            var attrs, attr, val;

            // Handle both `"key", value` and `{key: value}` -style arguments.
            if (_.isObject(key) || key == null) {
                attrs = key;
                options = value;
            } else {
                attrs = {};
                attrs[key] = value;
            }

            // Extract attributes and options.
            options || (options = {});
            if (!attrs) return this;
            if (attrs instanceof Model) attrs = attrs.attributes;
            if (options.unset) for (attr in attrs) attrs[attr] = void 0;

            // Run validation.
            if (!this._validate(attrs, options)) return false;

            // Check for changes of `id`.
            if (this.idAttribute in attrs) this.id = attrs[this.idAttribute];

            var changes = options.changes = {};
            var now = this.attributes;
            var escaped = this._escapedAttributes;
            var prev = this._previousAttributes || {};

            // For each `set` attribute...
            for (attr in attrs) {
                val = attrs[attr];

                if (val instanceof Hackbone.Collection) {
                    if (val.parent) error('Collection being set on this model already has a parent model');
                    val.parent = this;
                }

                // If the new and current value differ, record the change.
                if (!_.isEqual(getNestedAttr(now, attr), val) || (options.unset && _.has(now, attr))) {
                    deleteNestedAttr(escaped, attr);
                    (options.silent ? this._silent : changes)[attr] = true;
                }

                // Update or delete the current value.
                options.unset ? deleteNestedAttr(now, attr) : setNestedAttr(now, attr, val);

                // If the new and previous value differ, record the change.  If not,
                // then remove changes for this attribute.
                if (!_.isEqual(getNestedAttr(prev, attr), val) || (_.has(now, attr) != _.has(prev, attr))) {
                    this.changed[attr] = val;
                    if (!options.silent) this._pending[attr] = true;
                } else {
                    delete this.changed[attr];
                    delete this._pending[attr];
                }
            }

            // Fire the `"change"` events.
            if (!options.silent) this.change(options);
            return this;
        },

        // Remove an attribute from the model, firing `"change"` unless you choose
        // to silence it. `unset` is a noop if the attribute doesn't exist.
        unset:function (attr, options) {
            (options || (options = {})).unset = true;
            return this.set(attr, null, options);
        },

        // Clear all attributes on the model, firing `"change"` unless you choose
        // to silence it.
        clear:function (options) {
            (options || (options = {})).unset = true;
            return this.set(_.clone(this.attributes), options);
        },

        // Fetch the model from the server. If the server's representation of the
        // model differs from its current attributes, they will be overriden,
        // triggering a `"change"` event.
        fetch:function (options) {
            var self = this;
            return Hackbone.APITransport.sync('read', this, options)
                .success(function (attrs) {
                    self.set(attrs, options);
                });
        },

        // Set a hash of model attributes, and sync the model to the server.
        // If the server returns an attributes hash that differs, the model's
        // state will be `set` again.
        save:function (key, value, options) {
            var attrs, current;

            // Handle both `("key", value)` and `({key: value})` -style calls.
            if (_.isObject(key) || key == null) {
                attrs = key;
                options = value;
            } else {
                attrs = {};
                attrs[key] = value;
            }
            options = options ? _.clone(options) : {};

            // If we're "wait"-ing to set changed attributes, validate early.
            if (options.wait) {
                if (!this._validate(attrs, options)) return false;
                current = _.clone(this.attributes);
            }

            // Regular saves `set` attributes before persisting to the server.
            var silentOptions = _.extend({}, options, {silent:true});
            if (attrs && !this.set(attrs, options.wait ? silentOptions : options)) {
                return false;
            }

            // After a successful server-side save, the client is (optionally)
            // updated with the server-side state.

            var model = this;
            if (options.wait) this.set(current, silentOptions);

            // Finish configuring and sending the Ajax request.
            var method = this.isNew() ? 'create' : 'update';
            return Hackbone.APITransport.sync(method, this, options)
                .success(function (serverAttrs) {
                    if (options.wait) {
                        delete options.wait;
                        serverAttrs = _.extend(attrs || {}, serverAttrs);
                    }
                    if (!model.set(serverAttrs, options)) return false;
                    model.trigger('sync', model, serverAttrs, options);
                });
        },

        // Destroy this model on the server if it was already persisted.
        // Optimistically removes the model from its collection, if it has one.
        // If `wait: true` is passed, waits for the server to respond before removal.
        destroy:function (options) {
            options = options || {};
            var model = this;

            var triggerDestroy = function () {
                model.trigger('destroy', model, model.collection, options);
            };

            if (this.isNew()) {
                triggerDestroy();
                return false;
            }

            var sync = Hackbone.APITransport.sync('delete', this, options)
                .success(function (resp) {
                    if (options.wait) triggerDestroy();
                    model.trigger('sync', model, resp, options);
                })

            if (options.wait) this.trigger('waiting', model)
            else triggerDestroy();

            return sync;
        },

        // Create a new model with identical attributes to this one.
        clone:function () {
            return new this.constructor(this.attributes);
        },

        // A model is new if it has never been saved to the server, and lacks an id.
        isNew:function () {
            return this.id == null;
        },

        // Call this method to manually fire a `"change"` event for this model and
        // a `"change:attribute"` event for each changed attribute.
        // Calling this will cause all objects observing the model to update.
        change:function (options) {
            options || (options = {});
            var changing = this._changing;
            this._changing = true;

            // Silent changes become pending changes.
            for (var attr in this._silent) this._pending[attr] = true;

            // Silent changes are triggered.
            var changes = _.extend({}, options.changes, this._silent);
            this._silent = {};
            for (var attr in changes) {
                this.trigger('change:' + attr, this, this.get(attr), options);
            }
            if (changing) return this;

            // Continue firing `"change"` events while there are pending changes.
            while (!_.isEmpty(this._pending)) {
                this._pending = {};
                this.trigger('change', this, options);
                // Pending and silent changes still remain.
                for (var attr in this.changed) {
                    if (this._pending[attr] || this._silent[attr]) continue;
                    delete this.changed[attr];
                }
                this._previousAttributes = _.clone(this.attributes);
            }

            this._changing = false;
            return this;
        },

        // Determine if the model has changed since the last `"change"` event.
        // If you specify an attribute name, determine if that attribute has changed.
        hasChanged:function (attr) {
            if (!arguments.length) return !_.isEmpty(this.changed);
            return _.has(this.changed, attr);
        },

        // Return an object containing all the attributes that have changed, or
        // false if there are no changed attributes. Useful for determining what
        // parts of a view need to be updated and/or what attributes need to be
        // persisted to the server. Unset attributes will be set to undefined.
        // You can also pass an attributes object to diff against the model,
        // determining if there *would be* a change.
        changedAttributes:function (diff) {
            if (!diff) return this.hasChanged() ? _.clone(this.changed) : false;
            var val, changed = false, old = this._previousAttributes;
            for (var attr in diff) {
                if (_.isEqual(old[attr], (val = diff[attr]))) continue;
                (changed || (changed = {}))[attr] = val;
            }
            return changed;
        },

        // Get the previous value of an attribute, recorded at the time the last
        // `"change"` event was fired.
        previous:function (attr) {
            if (!arguments.length || !this._previousAttributes) return null;
            return this._previousAttributes[attr];
        },

        // Get all of the attributes of the model at the time of the previous
        // `"change"` event.
        previousAttributes:function () {
            return _.clone(this._previousAttributes);
        },

        // Check if the model is currently in a valid state. It's only possible to
        // get into an *invalid* state if you're using silent changes.
        isValid:function () {
            return !this.validate(this.attributes);
        },

        // Run validation against the next complete set of model attributes,
        // returning `true` if all is well. If a specific `error` callback has
        // been passed, call that instead of firing the general `"error"` event.
        _validate:function (attrs, options) {
            if (options.silent || !this.validate) return true;
            attrs = _.extend({}, this.attributes, attrs);
            var error = this.validate(attrs, options);
            if (!error) return true;
            if (options && options.error) {
                options.error(this, error, options);
            } else {
                this.trigger('error', this, error, options);
            }
            return false;
        },

        validate:function (attrs) {
            if (!this.validation) return;
            var sanidator = attrs ? new HashSanidator(attrs) : this.sanidator;
            sanidator.rules(this.validation)
            return !sanidator.hasErrors();
        },

        inc:function (path, increment, minZero) {
            increment = increment || 1;
            var v = this.get(path)
                , r = (isNaN(v) ? 0 : v) + increment
                ;
            if (minZero && r < 0) r = 0;
            this.set(path, r);
        }

    }

    // Index of available models
    var models = Model._models = {};

    //
    // All registered models will be given a unique name and indexed
    //
    Model.extend = function (props, statics) {
        // We want to force naming of models
        if (!props.name) error('You must supply a name when extending a Model', props, statics);
        if (models[props.name]) error('A Model\'s name must be unique', props.name, props, statics);
        if (!apiConfig.models[props.name]) error('Missing API configuration for model', props.name, props)
        return models[props.name] = Utils.extend.call(this, 'M_' + props.name, props, statics);
    };

    // Returns a registered model
    Model.get = function (name) {
        return models[name];
    }

    _.extend(Model.prototype, Events);


    //
    // Registry interaction
    //

    // Removes the model from the registry
    Model.prototype.unregister = function () {
        Hackbone.ModelRegistry.remove(this);
    }

    // Either creates a model or returns one from the registry
    Model.create = function (modelName, values, options) {
        var model;
        // Found one in registry, lets update it
        if (values && values['_id'] && (model = Hackbone.ModelRegistry.fetch(modelName, values['_id']))) {
            model.set(values);
            return model;
        }
        // Not found, actually creating
        model = new (Model.get(modelName))(values);
        Hackbone.ModelRegistry.add(model);
        return model;
    }

    //
    // Nested Setter & Getter helpers
    //

    // Nested Attributes helpers (accessing, deleting and setting)
    var getNestedAttr = function (obj, path) {
            var names = path.split('.')
                , name
                , value = obj
                ;
            while (value && (name = names.shift())) {
                value = value[name];
            }
            return value;
        }
        , deleteNestedAttr = function (obj, path) {
            var names = path.split('.')
                , name
                , value = obj
                ;
            while (value && names.length > 1 && (name = names.shift())) {
                value = value[name];
            }
            if (value && names.length) {
                delete value[names.shift()];
            }
        }
        , setNestedAttr = function (obj, path, setValue) {
            var names = path.split('.')
                , name
                , value = obj
                ;

            while (names.length > 1 && (name = names.shift())) {
                value = value[name] || (value[name] = {});
            }
            if (value && names.length) {
                value[names.shift()] = setValue;
            }
        }

    //
    // Utilities
    //

    // Nested change events support
    ModelChangeMap(Model, Hackbone);

    return Model;

});