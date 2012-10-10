define([
    'underscore',
    'lib/Backbone/Events',
    'lib/Backbone/Utils',
    'lib/Backbone/APITransport',
    'Model',
    'config',
    'lib/utils'
],
    function (_, Events, Utils, Transport, _Model, config, utils) {

        var Model = function () {
            return _Model || (_Model = require('Model'))
        }

        var error = utils.scopedError('CollectionError')

        // Provides a standard collection class for our sets of models, ordered
        // or unordered. If a `comparator` is specified, the Collection will maintain
        // its models in sort order, as they're added and removed.
        var Collection = function (models, options) {
            // Argument mapping
            if (!(models instanceof Array)) {
                options = models;
                models = null;
            }
            options || (options = {});

            if (options.comparator) this.comparator = options.comparator;
            if (options.url) this.url = options.url;
            this._reset();
            this.initialize.apply(this, arguments);
            if (models) this.reset(models, {silent:true});
        };

        Collection.prototype = {

            // Initialize is an empty function by default. Override it with your own
            // initialization logic.
            initialize:function () {},

            // The JSON representation of a Collection is an array of the
            // models' attributes.
            toJSON:function (options) {
                return this.map(function (model) { return model.toJSON(options); });
            },

            // Add a model, or list of models to the set. Pass **silent** to avoid
            // firing the `add` event for every new model.
            add:function (models, options) {
                var i, index, length, model, cid, id, cids = {}, ids = {}, dups = [];
                options || (options = {});
                models = _.isArray(models) ? models.slice() : [models];

                // Begin by turning bare objects into model references, and preventing
                // invalid models or duplicate models from being added.
                for (i = 0, length = models.length; i < length; i++) {
                    if (!(model = models[i] = this._prepareModel(models[i], options))) {
                        throw new Error("Can't add an invalid model to a collection");
                    }
                    cid = model.cid;
                    id = model.id;
                    if (cids[cid] || this._byCid[cid] || ((id != null) && (ids[id] || this._byId[id]))) {
                        dups.push(i);
                        continue;
                    }
                    cids[cid] = ids[id] = model;
                }

                // Remove duplicates.
                i = dups.length;
                while (i--) {
                    models.splice(dups[i], 1);
                }

                // Listen to added models' events, and index models for lookup by
                // `id` and by `cid`.
                for (i = 0, length = models.length; i < length; i++) {
                    (model = models[i]).on('all', this._onModelEvent, this);
                    this._byCid[model.cid] = model;
                    if (model.id != null) this._byId[model.id] = model;
                }

                // Insert models into the collection, re-sorting if needed, and triggering
                // `add` events unless silenced.
                this.length += length;
                index = options.at != null ? options.at : this.models.length;
                Array.prototype.splice.apply(this.models, [index, 0].concat(models));
                if (this.comparator) this.sort({silent:true});
                if (options.silent) return this;
                for (i = 0, length = this.models.length; i < length; i++) {
                    if (!cids[(model = this.models[i]).cid]) continue;
                    options.index = i;
                    model.trigger('add', model, this, options);
                }
                return this;
            },

            // Remove a model, or a list of models from the set. Pass silent to avoid
            // firing the `remove` event for every model removed.
            remove:function (models, options) {
                var i, l, index, model;
                options || (options = {});
                models = _.isArray(models) ? models.slice() : [models];
                for (i = 0, l = models.length; i < l; i++) {
                    model = this.getByCid(models[i]) || this.get(models[i]);
                    if (!model) continue;
                    delete this._byId[model.id];
                    delete this._byCid[model.cid];
                    index = this.indexOf(model);
                    this.models.splice(index, 1);
                    this.length--;
                    if (!options.silent) {
                        options.index = index;
                        model.trigger('remove', model, this, options);
                    }
                    this._removeReference(model);
                }
                return this;
            },

            // Add a model to the end of the collection.
            push:function (model, options) {
                model = this._prepareModel(model, options);
                this.add(model, options);
                return model;
            },

            // Remove a model from the end of the collection.
            pop:function (options) {
                var model = this.at(this.length - 1);
                this.remove(model, options);
                return model;
            },

            // Add a model to the beginning of the collection.
            unshift:function (model, options) {
                model = this._prepareModel(model, options);
                this.add(model, _.extend({at:0}, options));
                return model;
            },

            // Remove a model from the beginning of the collection.
            shift:function (options) {
                var model = this.at(0);
                this.remove(model, options);
                return model;
            },

            // Get a model from the set by id.
            get:function (id) {
                if (id == null) return void 0;
                return this._byId[id.id != null ? id.id : id];
            },

            // Get a model from the set by client id.
            getByCid:function (cid) {
                return cid && this._byCid[cid.cid || cid];
            },

            // Get the model at the given index.
            at:function (index) {
                return this.models[index];
            },

            // Return models with matching attributes. Useful for simple cases of `filter`.
            where:function (attrs) {
                if (_.isEmpty(attrs)) return [];
                return this.filter(function (model) {
                    for (var key in attrs) {
                        if (attrs[key] !== model.get(key)) return false;
                    }
                    return true;
                });
            },

            // Force the collection to re-sort itself. You don't need to call this under
            // normal circumstances, as the set will maintain sort order as each item
            // is added.
            sort:function (options) {
                options || (options = {});
                if (!this.comparator) throw new Error('Cannot sort a set without a comparator');
                var boundComparator = _.bind(this.comparator, this);
                if (this.comparator.length == 1) {
                    this.models = this.sortBy(boundComparator);
                } else {
                    this.models.sort(boundComparator);
                }
                if (!options.silent) {
                    this.trigger('reset', this, options);
                }
                return this;
            },

            // Pluck an attribute from each model in the collection.
            pluck:function (attr) {
                return _.map(this.models, function (model) { return model.get(attr); });
            },

            // When you have more items than you want to add or remove individually,
            // you can reset the entire set with a new list of models, without firing
            // any `add` or `remove` events. Fires `reset` when finished.
            reset:function (models, options) {
                models || (models = []);
                options || (options = {});
                for (var i = 0, l = this.models.length; i < l; i++) {
                    this._removeReference(this.models[i]);
                }
                this._reset();
                this.add(models, _.extend({silent:true}, options));
                if (!options.silent) this.trigger('reset', this, options);
                return this;
            },

            _sync: null,
            // Fetch the default set of models for this collection, resetting the
            // collection when they arrive. If `add: true` is passed, appends the
            // models to the collection instead of resetting.
            fetch:function (options) {
                if (this.inSync()) {
                    this._sync.xhr.abort()
                }

                options = options ? _.clone(options) : {};
                var self = this;

                return (this._sync = Transport.sync('read', this, options)
                    .success(function (models) {
                        self[options.add ? 'add' : 'reset'](models, options);
                    })
                    .complete(function () {
                        self.trigger('sync')
                        self._sync = null;
                    }))
            },

            has: function(model){
                return !!this.getByCid(model)
            },

            inSync:function () {
                return this._sync != null;
            },

            // Create a new instance of a model in this collection. Add the model to the
            // collection immediately, unless `wait: true` is passed, in which case we
            // wait for the server to agree.
            create:function (model, options) {
                var coll = this;
                options = options ? _.clone(options) : {};
                model = this._prepareModel(model, options);
                if (!model) return false;
                if (!options.wait) coll.add(model, options);

                model.save(null, options)
                    .success(function (serverAttrs) {
                        if (options.wait) coll.add(model, options);
                    });

                return model
            },

            // Proxy to _'s chain. Can't be proxied the same way the rest of the
            // underscore methods are proxied because it relies on the underscore
            // constructor.
            chain:function () {
                return _(this.models).chain();
            },

            // Reset all internal state. Called when the collection is reset.
            _reset:function (options) {
                this.length = 0;
                this.models = [];
                this._byId = {};
                this._byCid = {};
            },

            // Prepare a model or hash of attributes to be added to this collection.
            _prepareModel:function (model, options) {
                if (!(model instanceof Model())) {
                    var attrs = model;
                    model = Model().create(this.model.prototype.name, attrs, options);
                    if (!model._validate(model.attributes, options)) model = false;
                }
                model.collection = this;
                return model;
            },

            // Internal method to remove a model's ties to a collection.
            _removeReference:function (model) {
                if (this == model.collection) {
                    delete model.collection;
                }
                model.off('all', this._onModelEvent, this);
            },

            // Internal method called every time a model in the set fires an event.
            // Sets need to update their indexes when models change ids. All other
            // events simply proxy through. "add" and "remove" events that originate
            // in other collections are ignored.
            _onModelEvent:function (event, model, collection, options) {
                if ((event == 'add' || event == 'remove') && collection != this) return;
                if (event == 'destroy') {
                    this.remove(model, options);
                }
                if (model && event === 'change:' + model.idAttribute) {
                    delete this._byId[model.previous(model.idAttribute)];
                    this._byId[model.id] = model;
                }
                this.trigger.apply(this, arguments);
            }

        }

        var cols = Collection._cols = {}

        //
        // All registered collections will be given a unique name and indexed
        //
        Collection.extend = function (props, statics) {
            // We want to force naming of models
//            if (!props.name) error('You must supply a name when extending a Collection', props, statics);
            if (!props.name) return Utils.extend.call(this, 'Collection', props, statics);
            if (cols[props.name]) error('A Collection\'s name must be unique', props.name, props, statics);
            return cols[props.name] = Utils.extend.call(this, 'C_' + props.name, props, statics);
        };

        // Returns a registered model
        Collection.col = function (name) {
            return cols[name];
        }

        // Returns the model used in a given collection
        Collection.getModel = function (name) {
            return cols[name].prototype.model.prototype.name;
        }

        Collection.get = function (name) {
            return cols[name];
        }

        Collection.create = function (name, models, options) {
            return new cols[name](models, options)
        }

        _.extend(Collection.prototype, Events);


        // Underscore methods that we want to implement on the Collection.
        var methods = ['forEach', 'each', 'map', 'reduce', 'reduceRight', 'find',
            'detect', 'filter', 'select', 'reject', 'every', 'all', 'some', 'any',
            'include', 'contains', 'invoke', 'max', 'min', 'sortBy', 'sortedIndex',
            'toArray', 'size', 'first', 'initial', 'rest', 'last', 'without', 'indexOf',
            'shuffle', 'lastIndexOf', 'isEmpty', 'groupBy'];

        // Mix in each Underscore method as a proxy to `Collection#models`.
        _.each(methods, function (method) {
            Collection.prototype[method] = function () {
                return _[method].apply(_, [this.models].concat(_.toArray(arguments)));
            };
        });

        return Collection;

    });