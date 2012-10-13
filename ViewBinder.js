/**
 * Requirements: SugarJS, jQuery, Nested Backbone Change Events
 *
 *
 * Changelog:
 *
 * 12/09/2012
 *  Model functions will no longer be accessed via the ~ argument token.
 *
 */
define(function (require) {

        var Hackbone = require('./Hackbone')
            , Utils = require('./Utils')

        // Helper methods
        var getModelPathIdentifier = function (model, path) { return model.cid + '@' + path; }
            , isModel = function (v) { return v && v instanceof Hackbone.Model }
            , isCollection = function (v) { return v && v instanceof Collection }
            , error = function (e) {
                console.error.call(console, 'ViewBinderError: ' + e, Array.prototype.slice.call(arguments, 1));
                throw 'ViewBinderError: ' + e
            }
            , log = function (m) {
                console.log.call(console, '[ViewBinder] ' + m, Array.prototype.slice.call(arguments, 1));
            }
        // Helper to join arguments
            , joinArgs = function (args, index, chr) {
                return Array.prototype.slice.call(args, index || 0).join(chr || '');
            }
        // String indexOf which accepts array of charaters too
            , indexOf = function (str, chr, index) {
                if (typeof chr == 'string') return str.indexOf(chr, index);
                var p = -1, c = -1;
                for (var i = 0; i < chr.length; i++) {
                    if ((c = str.indexOf(chr[i], index)) != -1 && (p == -1 || c < p))
                        p = c;
                }
                return p;
            }
        // We must always use this Model object or its subclasses to make sure
        // the .get method gets called
        //
        // Note: it is very important for this prototype to be well mapped, so
        // we can detect and react properly to change events.
//            , modelPrototype = Hackbone.Model.prototype
            ;

        //
        // The ViewBinder is responsible for managing a view's data bindings
        //
        var ViewBinder = function (view) {
            // View instance to which we will bind model changes to the DOM
            this.view = view;
            this.context = view;
            // Track of all bindings
            this.bindings = [];
        }

        ViewBinder.prototype = {

            // Parses the DOM structure in search of binding elements
            // Note: this clears previous bindings, even if added manually
            parseElements:function () {
                // Elements which will be bound to data
                this.$els = this.view.$el.find('[data-bind]');
                if (!this.view.el && this.view.$el.is('[data-bind]')) {
                    this.$els = this.$els.add(this.view.$el)
                }
            },

            // Manually adds an element to the stack, and applies its bindings
            // You may pass the rules to be set on the elements' data-bind attr
            addElement:function ($el, rules) {
                this.$els.add($el)
                if (rules) $el.data('bind', rules);
                this._applyElementBindings($el);
            },

            // Builds all the dom bindings for the view
            buildBindings:function () {
                this.clearBindings();
                var self = this
                    ;
                this.$els.each(function (index, $el) {
                    self._applyElementBindings($el);
                });
            },

            // Applies data-bindings to a single element
            _applyElementBindings:function (el) {
                var $el = $(el)
                    , rules = new ViewBinder.BindingParser.parseRules($el.data('bind'))
                    , self = this
                    ;

                rules.each(function (rule) {
                    var handler = ViewBinder.BindHandler.getHandler(rule.handler)
                        , binding;

                    // Oops
                    if (!handler)
                        error('Invalid binding handler', rule.handler);
                    // Okay, lets put some context into the handler
                    else
                        handler = new handler($el, self.view);

                    // Binding around the model to detect changes
                    binding = new ViewBinder.ModelBinding(function () {
                        handler.run.apply(handler, rule.args && rule.args.call(self.context))
                    });

                    binding.build();
                    self.bindings.push({
                        handler:handler,
                        modelBinding:binding
                    });
                })
            },

            // Clears all bindings made to the elements
            clearBindings:function () {
                var binding;
                while (binding = this.bindings.shift()) {
                    binding.modelBinding.clear();
                    binding.handler.cleanup();
                }
            }
        };

        ViewBinder.BindingParser = (function () {
            var
            // This is a lookup table to cache arguments according to strings
                Cache = {}
            // Parses a binding string, returning the proper structure
                , BindingParser = function (str) {
                    this.str = str;
                    this.parseBindings();
                }
                ;
            // This should be the external interface - lookup cache or else parse the string
            BindingParser.parseRules = function (str) {
                var rules = Cache[str];
                if (rules) return rules;
                var parser = new BindingParser(str);
                return Cache[str] = parser.rules;
            }
            // Clears all parsed rules from cache
            BindingParser.clearCache = function () {
                Cache = {};
            }
            BindingParser.prototype = {

                // This is the token to separate different binding rules from each other
                bindingDelimiter:';',
                // This is the token to separate a binding's rule name from the arguments
                nameDelimiter:':',
                // Indicates the current string's character index being parsed
                i:0,
                // Indicates the last characted index which was extracted
                last:0,

                // The bindings must be supplied in a string with the following format:
                // name: args; name2: args; ...
                //
                // For example:
                //    attr: href /user/ ~user:id; src: /downloads/ ~user:name .jpg
                //
                //
                parseBindings:function () {
                    this.rules = [];
                    this.last = this.i = 0;
                    // Nothing to parse!
                    if (!this.str) return;

                    var m
                        , letter
                        ;

                    for (; this.i < this.str.length; this.i++) {
                        letter = this.str[this.i];

                        if (letter == this.nameDelimiter || letter == this.bindingDelimiter || (this.i == this.str.length - 1 && ++this.i)) {
                            // We must verify the name's length
                            m = this.str.substring(this.last, this.i).trim()
                            this.last = this.i + 1;
                            if (!m) {
                                continue;
                            }

                            // Regular binding, we'll delegate the rest of the parsing to
                            // the arguments' parser
                            if (letter == this.nameDelimiter) {
                                this.i++;
                                this.rules.push({
                                    handler:m,
                                    args:this.parseArguments()
                                });
                            }
                            // We have found a binding without any arguments
                            else {
                                this.rules.push({
                                    handler:m
                                });
                            }
                        }
                    }
                },


                // Parses a string which represents arguments to a handler
                // Arguments are general and are not handler specific..
                //
                // Arguments syntax:
                //
                // Model accessor
                //  ~[model|view_object:]<property|function>
                //      .e.g: ~name (same as ~model:name), or ~user:name
                //
                // Simple text
                //   "..."|'...'|[\S]
                //
                // JS Expression
                //   `expr`
                //      .e.g: `this.collection.length > 7`
                //
                //
                // This function returns a function which, when called, returns
                // an array of arguments produced from parsing.
                //
                // A function is returned so the arguments may have real-time values.
                //
                parseArguments:function () {
                    var m // Current argument
                        , str = this.str
                        , args = []
                        , p = 0 // Indicates the ending delimiter's position for a given context
                        , letter
                        , context // Parsing context, which is set given a starting token,
                    // Function to be returned
                        , f = function () {
                            var self = this;
                            try {
                                return args.map(function (o) { return typeof o == 'function' ? o.call(self) : o });
                            } catch (e) {
                                log("Argument execution exception - " + e, str, self)
                            }
                        }
                        ;

                    for (; this.i < str.length; this.i++) {
                        letter = str[this.i];
                        context = this.argsTokens[letter];
                        // Opening token found
                        if (context) {
                            p = indexOf(str, context.ending, this.i + 1);
                            // The token did not have its ending matched
                            if (p === -1) {
                                // But we allow a string's end to wrap this type of token
                                if (context.allowStringEnd) {
                                    p = str.length;
                                }
                                else error('Argument token expected', str, this.i, context)
                            }
                            m = str.substring(this.i + 1, p).trim();
                            this.i = p;
                            args.push(context.arg ? context.arg(m) : m);
                            this.last = p + 1;
                            if (str[this.last] == this.bindingDelimiter || str[p] == this.bindingDelimiter)
                                return f;
                        }
                        // Simplest arguments -- only text with no white spaces
                        else if ((letter == ' ') && (this.last < this.i)) {
                            m = str.substring(this.last, this.i).trim();
                            this.last = this.i + 1;
                            if (m) {
                                args.push(m.trim());
                            }
                        }
                        // End of parsing
                        else if (letter == this.bindingDelimiter) {
                            m = str.substring(this.last, this.i).trim();
                            this.last = this.i + 1;
                            if (m) {
                                args.push(m.trim());
                            }
                            return f;
                        }
                    }

                    if (this.last < str.length - 1) {
                        args.push(str.substring(this.last, str.length).trim())
                    }

                    // We now return a function which maps all the arguments to realtime state values
                    // of the view and its models
                    return f;
                },

                //
                // Tokens used in arguments parsing
                //
                argsTokens:{
                    '`':{
                        ending:'`',
                        arg:function (v) {
                            return new Function('return ' + v);
                        }
                    },
                    '\"':{
                        ending:'\"'
                    },
                    '\'':{
                        ending:'\''
                    },
                    '~':{
                        ending:[' ', ';'],
                        // Indicates that the end of a string also means the end of the arg
                        allowStringEnd:true,
                        arg:function (v) {
                            var negative = v[0] == '!';
                            // We support negative evaluation of a value
                            if (negative) v = v.substring(1);
                            v = v.split(':');
                            if (v.length == 1) {
                                v[1] = v[0];
                                v[0] = 'model';
                            }
                            return (function (name, prop) {
                                var getProp = function () {
                                    var p = this[name];
                                    if (!prop) return p;
                                    if (!isModel(p)) return p && p[prop];
                                    return p.get(prop)
                                }
                                return negative ? function () { return !getProp.call(this) } : getProp;
                            })(v[0], v[1])
                        }
                    }
                }

            }

            return BindingParser;
        })();

        // Applies a specific binding handler, wrapping the
        // function around a sensible mechanism which will detect changes to
        // the model and then propagate it accordingly to the bindings
        ViewBinder.ModelBinding = function (callback) {
            this.callback = callback;
            this.listeners = {};
            // Function to be applied to changed events, to make sure the
            // dependencies stay sync'd with the models
            this._onChangeFn = (this._onChangeFn).bind(this);
        }

        ViewBinder.ModelBinding.prototype = {

            // Binds to changes on a given model and its path, uniquely
            bindToChanges:function (model, path) {
                var id = getModelPathIdentifier(model, path);
                if (this.listeners[id]) return;
                this.listeners[id] = {obj:model, ev:'change:' + path};
                model.on(this.listeners[id].ev, this._onChangeFn);
            },

            // Placeholder function to be bound on the constructor
            // TODO Avoid rebinding to ALL the models; expensive
            _onChangeFn:function (model, value) {
                if (isModel(value)) this.build();
                else this.callback();
            },

            // Builds all the bindings from this function, binding to change events
            // based on .get calls from the models
            // Since this might be expensive, it shouldn't be called at will
            build:function () {
                var get = Hackbone.Model.prototype.get
                    , self = this
                    ;
                this.clear();
                // We create a thin wrapper around .get to listen
                // to dependencies
                Hackbone.Model.prototype.get = function (path) {
                    self.bindToChanges(this, path);
                    return get.apply(this, arguments)
                }
                this.callback();
                // And then restore the original method
                Hackbone.Model.prototype.get = get;
            },

            // Clears all the binds to model changes made so far
            clear:function () {
                for (var id in this.listeners) {
                    this.listeners[id].obj.off(this.listeners[id].ev, this._onChangeFn);
                }
                this.listeners = {};
            }
        }

        //
        // Object corresponding to a binding handler, this receives the binding element
        //
        // When setup, exec, and cleanup are called, they will be applied to the context of a BindHandler instance.
        // This context is all yours, do whatever you'd like with it :)
        //
        ViewBinder.BindHandler = function ($el, view) {
            this.$el = $el;
            this.view = view;
        };

        ViewBinder.BindHandler.prototype = {
            // Function to be called from the outer world, which handles the
            // proper execution of a setup function, which has to be ran only for a
            // first time
            run:function () {
                this.setup.apply(this, arguments);
                this.run = this.exec;
                return this.exec.apply(this, arguments);
            },
            // Function to be called when a new binding is applied to an element
            setup:function () {
            },
            // Function the be called whenever the binding has to be executed
            exec:function () {
            },
            // Function to be called when binding is to be removed
            cleanup:function () {
            }
        };

        // Inheritability
        ViewBinder.BindHandler.extend = Utils.namedExtend('ViewBinder');

        // Handlers registry
        ViewBinder.BindHandler.handlers = {};
        // Configure many handlers at once, through an object
        ViewBinder.BindHandler.setHandlers = function (handlers) {
            for (var name in handlers) {
                ViewBinder.BindHandler.setHandler(name, handlers[name])
            }
        }

        // Configures a single binding handler
        ViewBinder.BindHandler.setHandler = function (name, handler) {
            if (typeof handler == 'function') {
                handler = ViewBinder.BindHandler.extend({
                    exec:handler
                });
            } else if (typeof handler == 'object') {
                handler = ViewBinder.BindHandler.extend(handler)
            } else
                error('Invalid handler definition for', name, handler, handlers)

            if (ViewBinder.BindHandler.handlers[name])
                log('Overriding handler', name);
            ViewBinder.BindHandler.handlers[name] = handler;
        }

        ViewBinder.BindHandler.getHandler = function (name) {
            return ViewBinder.BindHandler.handlers[name];
        }

        //
        // Binding handlers will be called with the ViewBinder's scope
        //
        ViewBinder.BindHandler.setHandlers({

            // Handler for any kind of custom function to take over the data binding process
            //
            // The binding function will receive the element being bound `$el`, and the arguments
            // `args`
            //
            fn:function (name) {
                var callback = this.view[name];
                if (typeof callback != 'function') error('Invalid function call', name);
                callback.apply(this.view, arguments);
            },

            // Changes the text, escaping it (jQuery delegation)
            text:function () {
                this.$el.text(joinArgs(arguments, 0, ' '));
            },

            // Simple date formatting
            date:function (date, format, locale) {
                this.$el.text(date.format(format, locale))
            },

            // Date formatting with relative support
            'relative-date':function (date, format) {
                this.$el.text(date.relative('pt'))
            },

            // Changes the HTML contents, without escaping
            html:function () {
                this.$el.html(joinArgs(arguments));
            },

            attr:function (name) {
                this.$el.attr(name, joinArgs(arguments, 1))
            },

            href:function () {
                this.$el.attr('href', joinArgs(arguments))
            },

            src:function () {
                this.$el.attr('src', joinArgs(arguments));
            },

            alt:function () {
                this.$el.attr('alt', joinArgs(arguments));
            },

            css:function (name, val) {
                this.$el.css(name, val)
            },

            // Sets the element's class to all the arguments as class names
            'class':function () {
                this.$el.attr('class', joinArgs(arguments, 0, ' '));
            },

            value:function (val) {
                this.$el.val(joinArgs(arguments, 0, ' '));
            },

            // Binds the element's inner text to a collection's length, or
            // simply its text to an Array's length
            //
            // Note: Doesn't yet support collection changing (quite easy to do so though)
            length:{

                setup:function (obj) {
                    if (obj instanceof Array) return;
                    if (!(obj instanceof Collection)) return error('Invalid object for length binding, expected Array or Collection', obj, this);
                    this.collection = obj;
                    this.collection.on('all', this.update, this);
                    this.update();
                },

                // Setups the collection binding and rendering
                update:function () {
                    this.$el.text(this.collection.length);
                },

                // Getting rid of the events
                cleanup:function () {
                    this.collection.off(null, null, this);
                }
            },

            // Toggles the state of the element according to a boolean parameter
            visible:function (state, display) {
                this.$el.css('display', state ? display || '' : 'none');
            },

            // Simple console logging
            log:function () {
                log.apply(log, arguments);
            },

            // Binds the model to a given input
            input:{
                // Starts listening to Router events
                setup:function (name, model) {
                    this.model = model || this.view.model
                    this.name = name;

                    var self = this
                    this.model.on('change:' + name, this.syncFromModel.bind(this))
                    this.$el.change(this.syncToModel.bind(this))

                    if (this.$el.val()) {
                        this.syncToModel()
                    } else {
                        this.syncFromModel()
                    }
                },

                syncFromModel:function () {
                    this.$el.val(this.model.get(this.name))
                },

                syncToModel:function () {
                    var names = this.name.split('.')
                        , rest = []
                        , name
                        , value = this.model
                        , model = this.model
                        ;
                    while (value && (name = names.shift()) && rest.push(name)) {
                        value = value instanceof Model ? value.attributes[name] : value[name];
                        if (value instanceof Model){
                            model = value
                            rest = []
                        }
                    }
                    if (!rest.length){
                        error("You shouldn't be overriding a model with some plain value")
                    }
                    model.set(rest.join('.'), this.$el.val())
                }
            },

            // Adds a 'current' class on current links, according to the Router
            'route-links':{
                update:function () {
                    if (this.selector)
                        this.$el.find(this.selector).removeClass(this.cls)
                            .filter('[href="#' + this.Router.instance.getHash() + '"]').addClass(this.cls);
                },
                // Starts listening to Router events
                setup:function (selector, cls) {
                    var self = this;
                    this.selector = selector || 'a'
                    this.cls = cls || 'current'
                    require(['m/Router'], function (Router) {
                        self.Router = Router;
                        self.update();
                        Router.bind(self.update.bind(self));
                    });
                }
            },

            // Renders a collection in the element
            collection:{
                setup:function (collection, viewName, options) {

                    this.options = options || {}
                    this.renderedCount = 0
                    this.renderModel = this.renderModel.bind(this);

                    var self = this;
                    if (!collection) error('Invalid collection', collection, viewName, this);

                    require(['views/' + viewName], function (modelView) {
                        if (self.view.removed) return;
                        self.modelView = modelView;
                        self.modelViews = {};

                        self.collection = collection;
                        self.collection.each(self.renderModel)
                        self.collection.on('add', self.renderModel, self)
                        self.collection.on('remove', self.removeModel, self)
                        self.collection.on('reset', function () {
                            self.clearViews();
                            self.collection.each(self.renderModel)
                        }, self)
                    })
                },

                // Renders a single collection model
                renderModel:function (model) {
                    if (this.options.limit && this.renderedCount >= this.options.limit) {
                        return
                    }

                    var self = this;
                    var view = new this.modelView({
                        model:model,
                        appendTo:!this.options.prepend ? this.$el : null,
                        prependTo:this.options.prepend ? this.$el : null
                    });
                    view.built(function () {
                        view.$el.data('cid', model.cid)
                        self.view.trigger('@collection/renderModel', model, view)
                    });
                    this.modelViews[model.cid] = view;
                    this.renderedCount++
                },

                // Removes a previously rendered model view
                removeModel:function (model) {
                    var view = this.modelViews[model.cid];
                    if (!view) return;
                    view.remove();
                    delete this.modelViews[model.cid];
                    this.renderedCount--
                },

                clearViews:function () {
                    for (var cid in this.modelViews) {
                        this.modelViews[cid].remove();
                        delete this.modelViews[cid];
                    }
                    this.renderedCount = 0
                },

                // We must be sure that all views are removed properly!
                cleanup:function () {
                    this.clearViews();
                    this.collection.off(null, null, this);
                }
            },

            // Renders a view in the element
            view:{
                // Setups the collection binding and rendering
                setup:function (viewName, a, b) {
                    var self = this;
                    require(['views/' + viewName], function (boundView) {
                        if (self.view.removed) return;
                        self.boundView = new boundView({
                            el:self.$el,
                            model:(a instanceof Hackbone.Model && a) || (b instanceof Hackbone.Model && b),
                            collection:(a instanceof Hackbone.Collection && a) || (b instanceof Hackbone.Collection && b)
                        });
                    })
                },

                // We must be sure that all views are removed properly!
                cleanup:function () {
                    this.boundView && this.boundView.remove();
                }
            }

        });

        return ViewBinder;
    }
)