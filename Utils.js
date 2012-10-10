define([ 'underscore', 'config'],
    function (_, config) {
        // Shared empty constructor function to aid in prototype-chain creation.
        var ctor = function () {}
        var Utils = {

            namedExtend:function (name) {
                return function (protoProps, classProps) {
                    return Utils.extend.call(this, name, protoProps, classProps)
                }
            },

            // The self-propagating extend function that Backbone classes use.
            extend:function (name, protoProps, classProps) {
                if (typeof name == 'object') {
                    classProps = protoProps;
                    protoProps = name;
                    name = null;
                }
                // Little hack to name the objects when debugging
                if (name && config.inheritNames) {
                    var self = this
                        , f = protoProps.hasOwnProperty('constructor') ? protoProps.constructor : self
                        , evalStr = ''
                    evalStr += 'var ' + name + ' = function(){ f.apply(this, arguments); };';
                    evalStr += 'protoProps.constructor = ' + name + ';'
                    eval(evalStr);
                }
                var child = Utils.inherits(this, protoProps, classProps);
                child.extend = this.extend || Utils.extend;
                return child;
            },

            // Helper function to get a value from a Backbone object as a property
            // or as a function.
            getValue:function (object, prop) {
                if (!(object && object[prop])) return null;
                return _.isFunction(object[prop]) ? object[prop]() : object[prop];
            },

            // Helper function to correctly set up the prototype chain, for subclasses.
            // Similar to `goog.inherits`, but uses a hash of prototype properties and
            // class properties to be extended.
            inherits:function (parent, protoProps, staticProps) {
                var child;

                // The constructor function for the new subclass is either defined by you
                // (the "constructor" property in your `extend` definition), or defaulted
                // by us to simply call the parent's constructor.
                if (protoProps && protoProps.hasOwnProperty('constructor')) {
                    child = protoProps.constructor;
                } else {
                    child = function () { parent.apply(this, arguments); };
                }

                // Inherit class (static) properties from parent.
                _.extend(child, parent);

                // Set the prototype chain to inherit from `parent`, without calling
                // `parent`'s constructor function.
                ctor.prototype = parent.prototype;
                child.prototype = new ctor();

                // Add prototype properties (instance properties) to the subclass,
                // if supplied.
                if (protoProps) _.extend(child.prototype, protoProps);

                // Add static properties to the constructor function, if supplied.
                if (staticProps) _.extend(child, staticProps);

                // Correctly set child's `prototype.constructor`.
                child.prototype.constructor = child;

                // Set a convenience property in case the parent's prototype is needed later.
                child.__super__ = parent.prototype;

                return child;
            }

        }
        return Utils;
    }
);

