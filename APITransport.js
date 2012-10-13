define(function (require) {

    var $ = require('jquery')
        , config = require('config').api
        , Utils = require('./Utils')
        , Hackbone = require('./Hackbone')

    var isCollection = function (obj) { return obj instanceof Hackbone.Collection }
        , isModel = function (obj) { return obj instanceof Hackbone.Model }
        , slice = function (obj, index) {
            return Array.prototype.slice.call(obj, index)
        }
    // Parses server attributes according to a model's schema
        , parseAttributes = function (attrs, schema) {
            var val, attrType;

            for (var name in schema) {
                attrType = schema[name]
                val = attrs[name]

                // Nothing to parse ..
                if (val === null || typeof val == 'undefined') continue;

                // Collection
                if (attrType instanceof Array) {
                    var modelConfig = config.models[Hackbone.Collection.getModel(attrType[0])];
                    if (!modelConfig) error('Invalid model for collection', attrType[0]);
                    if (!(val instanceof Array)) {
                        attrs[name] = Hackbone.Collection.create(attrType[0]);
                    } else {
                        attrs[name] = Hackbone.Collection.create(attrType[0], val.map(function (obj) {
                            return parseAttributes(obj, modelConfig.schema)
                        }));
                    }
                }
                // Model
                else if (typeof attrType == 'string') {
                    if (!config.models[attrType]) error('Invalid model for association', attrType);
                    // ObjectId
                    if (typeof val == 'string') {
                        // Fetch from registry
                        attrs[name] = Hackbone.ModelRegistry.fetch(attrType, val) || Hackbone.Model.create(attrType, {_id:val});
                    }
                    // Object
                    else if (typeof val == 'object') {
                        // Expand it to be a new model then
                        attrs[name] = Hackbone.Model.create(attrType, parseAttributes(val, config.models[attrType].schema));
                    }
                    // Apparently invalid value, let's remove it
                    else {
                        delete attrs[name];
                    }
                }
                // Function, which may be constructed, like Date
                else if (typeof attrType == 'function') {
                    attrs[name] = new attrType(val);
                }
            }
            return attrs;
        }
    // Parses the given set of models into the Hackbone.ModelRegistry
        , parseModels = function (models) {
            for (var name in models) {
                models[name] = models[name].map(function (attrs) {
                    return Hackbone.Model.create(name, parseAttributes(attrs, config.models[name].schema))
                })
            }
        }
        , modelToJSON = function (model) {
            return model.toJSON()
        }
        , error = Utils.scopedError('APITransport')
        , log = Utils.scopedLog('APITransport')
// Map from CRUD to HTTP for our default `Backbone.sync` implementation.
        , methodMap = {
            'create':'POST',
            'update':'PUT',
            'delete':'DELETE',
            'read':'GET'
        }
// Throw an error when a URL is needed, and none is supplied.
        , urlError = function () {
            throw new Error('A "url" property or function must be specified');
        }
    // Resolves the URL for the object
        , resolveUrl = function (obj) {
            if (isModel(obj)) {
                var spec = config.models[obj.name]
                if (!spec) error('Missing configuration for model', obj.name, obj);
                if (!spec.url && !spec.embedded) error('Missing url for model', obj.name, obj)
                // Embedded indicates this model lives within another model and doesn't have a flat endpoint for itself
                if (spec.embedded && !isCollection(obj.collection)) error('Missing collection for embedded document url', obj.name, obj);
                return (spec.embedded ? resolveUrl(obj.collection) : spec.url) + (obj.isNew() ? '' : '/' + obj.id);
            }
            // Collection
            if (obj.embedded && !isModel(obj.parent)) error('Missing parent for embedded collection', obj.name, obj.parent, obj)
            if (!obj.url) error('Missing url for collection', obj.name, obj);
            return obj.embedded ? resolveUrl(obj.parent) + obj.url : obj.url;
        }
    // Lets expand the results which have the form
    // [ModelName, id, id2, ..., idN]
        , expandResultModels = function (result) {
            var name = result[0]
                , models = []
            for (var i = 1; i < result.length; i++) {
                models.push(Hackbone.ModelRegistry.fetch(name, result[i]))
            }
            return models;
        }
        , isObjectId = function (str) {
            return str.length == 24;
        }
        ;


    /**
     *
     * This is the only point of server interaction,
     * where all the parsing occurs
     *
     */
    var APITransport = {

        sync:function (method, obj, options) {

            options = options || {};
            var _isModel = isModel(obj)
                , _isCollection = isCollection(obj)

            if (_isCollection && method != 'read') error('You may only read from a collection');
            if (!_isModel && !_isCollection) error('Invalid object, only a Model or a Collection may be sync\'d', obj);

            // Default JSON-request options.
            var params = {
                type:methodMap[method],
                dataType:'json',
                url:options.url || config.basePath + resolveUrl(obj)
            };

            // GETing = filtering by query string
            if (method == 'read' && options.data) {
                params.data = options.data;
            }
            // These operations need the model's attribte as a body
            else if (obj && (method == 'create' || method == 'update')) {
                params.contentType = 'application/json';
                params.data = JSON.stringify(modelToJSON(obj));
            }

            // Don't process data on a non-GET request.
            if (params.type !== 'GET') {
                params.processData = false;
            }

            // This is how the outer world will be aware of us
            var promise = new Promise
            // We need a model schema in order to parse it
                , schema = _isModel && obj.name && config.models[obj.name] && (config.models[obj.name].schema || {})
                ;

            if (_isModel && !schema) error('Invalid model schema!', obj.name, obj, config, schema);

            // Actual API Call
            promise.xhr = $.ajax(params)
                .success(function (res) {
                    if (method == 'delete') {
                        return promise.fire('success', result)
                    }
//                    log('Incoming response', params.url, method, res)

                    var result = res.result;

                    // All models from the response should be parsed into our Registry -- they are fresh
                    parseModels(res.models)

//                    if (!res.status) error('Invalid response, expected a status', res)
                    if (!res.result) error('Invalid response, result expected', res)

                    // If the result is an array, it's a set of results from the
                    // packaged models, of the form ['ModelName', id, id2, ..., idN]
                    if (result instanceof Array) {
                        // Lets pull them from Registry
                        result = expandResultModels(result, schema);
                    }
                    // Attributes given -- this should only be given upon resource creation
                    else if (typeof result == 'object') {
                        result = parseAttributes(result, schema)
                    }
                    // The result is actually a ModelName, which maps to one of the array of models
                    // sent
                    else if (typeof result == 'string') {
                        result = res.models[result] || [];
                    }

                    promise.fire('success', result, res)
                })
                .complete(function (a, b, c) {
                    promise.fire('complete', a, b, c)
                })
                // Oops -- something went wrong
                .error(function (xhr, code, data) {
                    if (code == 'abort') {
                        return
                    }
                    var res;
                    try {
                        res = $.parseJSON(xhr.responseText);
                    } catch (e) {
                    }
                    // Unexpected error!
                    if (xhr.status == 200 || !res || !res.errors) {
                        log('Invalid API response', xhr, code, data)
                        promise.fire('error', xhr, code, data)
                    } else {
                        promise.fire('error', res.errors)
                    }
                })

            return promise;
        }

    }

    /**
     * API Transport Promise
     */
    var addCallback = function (name, cb) {
        this._callbacks[name] ? this._callbacks[name].push(cb) : (this._callbacks[name] = [cb])
        return this;
    }
    var Promise = function () {
        this._callbacks = {}
    }
    Promise.prototype = {
        fire:function (name, obj) {
            var cbs = this._callbacks[name];
            if (cbs) {
                var cb;
                while (cb = cbs.shift()) {
                    cb.apply(obj, Array.prototype.slice.call(arguments, 1));
                }
            }
        },
        success:function (cb) {
            return addCallback.call(this, 'success', cb)
        },
        error:function (cb) {
            return addCallback.call(this, 'error', cb)
        },
        complete:function (cb) {
            return addCallback.call(this, 'complete', cb)
        }
    }

    return APITransport;

})