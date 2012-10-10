define(
    [
        'jquery',
        'underscore',
        'lib/Backbone/ViewBinder',
        'lib/Backbone/Events',
        'lib/Backbone/Utils',
        'lib/utils'
    ],
    /**
     * Simples wrapper de modelos
     */
        function ($, _, ViewBinder, Events, Utils, utils) {

        // List of view options to be merged as properties.
        var error = utils.scopedError('View')
        // Cached regex to split keys for `delegate`.
            , delegateEventSplitter = /^(\S+)\s*(.*)$/
            ;

        // Creating a Backbone.View creates its initial element outside of the DOM,
        // if an existing element is not provided...
        var View = function (options, cb) {
            options = options || {};

            // cb is the function to be called once the view has been constructed
            if (typeof options == 'function') {
                cb = options;
                options = {};
            } else if (!cb) {
                cb = options.built
            }

            this._removables = [];
            this._builtCallbacks = cb ? [cb] : [];

            var self = this;

            this.cid = _.uniqueId('view');
            this._configure(options);
            this._translateEvents();

            // Binding
            this.binder = new ViewBinder(this);

            // We don't need the template to ensure an element container!
            this._ensureElement();

            // Expecting a template name, which will be automatically loaded
            if (typeof this.template == 'string') {
                require([this._templatePath(this.template)], function (html) {
                    self.template = _.template(html);
                    self._build();
                });
                return;
            }
            // Otherwise, we must have a template as a function (already compiled)
            else if (this.template && typeof this.template != 'function') {
                error('Invalid template')
            }
            this._build();
        }


        View.prototype = {

            // The default `tagName` of a View's element is `"div"`.
            tagName:'div',

            // jQuery delegate for element lookup, scoped to DOM elements within the
            // current view. This should be prefered to global lookups where possible.
            $:function (selector) {
                return this.$el.find(selector);
            },

            // Initialize is an empty function by default. Override it with your own
            // initialization logic.
            initialize:function () {},

            // **render** is the core function that your view should override, in order
            // to populate its element (`this.el`), with the appropriate HTML. The
            // convention is for **render** to always return `this`.
            render:function () {
                return this;
            },

            // For small amounts of DOM Elements, where a full-blown template isn't
            // needed, use **make** to manufacture elements, one at a time.
            //
            //     var el = this.make('li', {'class': 'row'}, this.model.escape('title'));
            //
            make:function (tagName, attributes, content) {
                var el = document.createElement(tagName);
                if (attributes) $(el).attr(attributes);
                if (content) $(el).html(content);
                return el;
            },

            // Change the view's element (`this.el` property), including event
            // re-delegation.
            setElement:function (element, delegate) {
                if (this.$el) this.undelegateEvents();
                this.$el = (element instanceof $) ? element : $(element);
                this.el = this.$el[0];
                if (delegate !== false) this.delegateEvents();
                return this;
            },

            // Set callbacks, where `this.events` is a hash of
            //
            // *{"event selector": "callback"}*
            //
            //     {
            //       'mousedown .title':  'edit',
            //       'click .button':     'save'
            //       'click .open':       function(e) { ... }
            //     }
            //
            // pairs. Callbacks will be bound to the view, with `this` set properly.
            // Uses event delegation for efficiency.
            // Omitting the selector binds the event to `this.el`.
            // This only works for delegate-able events: not `focus`, `blur`, and
            // not `change`, `submit`, and `reset` in Internet Explorer.
            delegateEvents:function (events) {
                if (!(events || (events = Utils.getValue(this, 'events')))) return;
                this.undelegateEvents();
                for (var key in events) {
                    var method = events[key];
                    if (!_.isFunction(method)) method = this[events[key]];
                    if (!method) throw new Error('Method "' + events[key] + '" does not exist');
                    var match = key.match(delegateEventSplitter);
                    var eventName = match[1], selector = match[2];
                    method = _.bind(method, this);
                    eventName += '.delegateEvents' + this.cid;
                    if (selector === '') {
                        this.$el.bind(eventName, method);
                    } else {
                        this.$el.delegate(selector, eventName, method);
                    }
                }
            },

            // Clears all callbacks previously bound to the view with `delegateEvents`.
            // You usually don't need to use this, but may wish to if you have multiple
            // Backbone views attached to the same DOM element.
            undelegateEvents:function () {
                this.$el.unbind('.delegateEvents' + this.cid);
            },

            // Ensure that the View has a DOM element to render into.
            // If `this.el` is a string, pass it through `$()`, take the first
            // matching element, and re-assign it to `el`. Otherwise, create
            // an element from the `id`, `className` and `tagName` properties.
            _ensureElement:function () {
                if (!this.el) {
                    var attrs = Utils.getValue(this, 'attributes') || {};
                    if (this.id) attrs.id = this.id;
                    if (this.className) attrs['class'] = this.className;
                    this.setElement(this.make(this.tagName, attrs), false);
                } else {
                    this.setElement(this.el, false);
                }
            },

            //
            // View dependencies async loading
            // The view will fire callbacks once the views' dependencies have been
            // properly loaded
            //

            // Builds the view after everything has been properly loaded
            _build:function () {
                // We have issued a cancel before the view was built
                if (this.removed) return;

                if (this.options.appendTo) {
                    this.$el.appendTo(this.options.appendTo)
                }
                if (!this.renderTemplate()){
                    this.mapElements();
                    this.delegateEvents();
                }
                this.initialize.call(this, this.options);
                this._built = true;

                // Everything properly initialized, the outer world may act now!
                this._fireBuiltCallbacks();
            },

            _built:false,
            _fireBuiltCallbacks:function () {
                var cb;
                while (cb = this._builtCallbacks.shift()) {
                    cb.call(this);
                }
            },
            // Adds a callback to be called once the view has been initialized
            built:function (cb) {
                if (this._built) {
                    cb.call(this);
                } else {
                    this._builtCallbacks.push(cb);
                }
                return this;
            },

            // Indicates whether the view has been removed
            removed:false,

            //
            // Inheritable handlers
            //

            // Function to be always called before data binding
            beforeBinding:function () {
            },

            // Custom function to clean the view before removal
            beforeRemove:function () {
            },

            afterRender:function () {

            },


            // Renders the default view's template.
            // This is quite expensive and should be avoided
            renderTemplate:function () {
                if (this.template) {
                    // Cleanup
                    this._clearBindings();
                    this.undelegateEvents();
                    if (this._$template) {
                        this.beforeRemove();
                        this._$template.remove();
                    }
                    // Building
                    this._$template = $(this._renderedTemplate());
                    this.$el.append(this._$template);
                    // Binding
                    this._buildBindings();
                    this.mapElements();
                    this.delegateEvents();
                    this.afterRender();
                    return true;
                }
                return false;
            },

            _clearBindings:function () {
                this.binder.clearBindings();
            },

            // Build bindings for the current context
            _buildBindings:function () {
                this.beforeBinding();
                this.binder.parseElements();
                this.binder.buildBindings();
            },

            // Returns the template rendered for this view
            _renderedTemplate:function () {
                return this.template &&
                    this.template.call(this, _.extend({}, this.viewLocals()))
            },

            // Mapeamento de alguns elementos do DOM direto na view, com wrapper jQuery, como propriedades
            // do tipo $<nome>
            mapElements:function () {
                if (this.$els) {
                    for (var key in this.$els) {
                        this[key] = this.$(this.$els[key]);
                        if (!this[key].size()) {
                            this[key] = this.$el.filter(this.$els[key]);
                        }
                    }
                }
            },

            // Translates events according to $els mappings
            _translateEvents:function () {
                var self = this;
                // Mapeamento de eventos da view, suportando os objetos definidos em $els
                if (this.$els && this.events) {
                    var $elsRegExp = Object.keys(this.$els).join('(?=[^A-Za-z0-9]|$)|\\');
                    if ($elsRegExp.length) {
                        $elsRegExp = new RegExp('\\' + $elsRegExp + '(?=[^A-Za-z0-9]|$)');
                        for (var key in this.events) {
                            var handler = this.events[key];
                            var repl = key.replace($elsRegExp, function (w) { return self.$els[w]; })
                            if (repl != key) {
                                delete(this.events[key]);
                                this.events[repl] = handler;
                            }
                        }
                    }
                }
            },

            // Performs the initial configuration of a View with a set of options.
            // ** Keys with special meaning *(model, collection, id, className)*, are
            // ** attached directly to the view.
            // ******** > ALL KEYS are attached
            _configure:function (options) {
                if (this.options) options = _.extend({}, this.options, options);
                var self = this;
                // We automatically inherit all options
                _.each(options, function (val, name) {
                    self[name] = val;
                });
                this.options = options;
            },

            // Returns the path where to find the template
            _templatePath:function (name) {
                return 'text!templates/' + name + '.html'
            },

            // Retorna valores locais para esta view
            viewLocals:function () {
                var locals = {};
                if (!this.locals) return locals;
                for (var key in this.locals) {
                    locals[key] = typeof this.locals[key] == 'function' ? this.locals[key].apply(this) : this.locals[key];
                }
                return locals
            },

            _removables:[],

            // Adds a removable object to the view's registry so it can be cleaned up
            // upon view removal
            // @method must either be a String or a Function
            removable:function (obj, method, args) {
                method = method || 'remove'
                this._removables.push({
                    obj:obj,
                    method:typeof method == 'string' ? obj[method] : method,
                    args:args
                });
                return obj;
            },

            _cleanupRemovables:function () {
                var removable;
                while (removable = this._removables.shift()) {
                    removable.obj && removable.method.apply(removable.obj, removable.args);
                }
                return;
            },

            // Removes the view from the DOM structure and clears its bindings
            remove:function (obj) {
                // We are simlpy issuing a removal of a single object
                if (obj) {
                    return this._removeObject(obj);
                }
                // View hasn't even been built yet, so let's quietly let this go
                // and not build it once the time comes
                this.removed = true;
                if (!this._built) {
                    this.$el && this.$el.remove();
                    return;
                }
                this.beforeRemove();
                this._cleanupRemovables();
                this._clearBindings();
                this.undelegateEvents();
                if (obj !== false) {
                    this.$el.remove();
                }
                this.trigger('remove');
            },

            _removeObject:function (obj) {
                if (!obj) return
                var name;
                if (typeof obj == 'string') {
                    name = obj;
                    obj = this[name];
                    if (!obj) return;
                }
                obj.remove();
                var self = this;
                this._removables.each(function (removable, i) {
                    if (removable.obj == obj) {
                        self._removables.splice(i, 1);
                        return false;
                    }
                })
                if (name) {
                    delete this[name];
                }
                return;
            },

            error:error
        }

        var views = {}

        View.extend = function (props, statics) {
            // We want to force naming of models
//            if (!props.name) error('You must supply a name when extending a Collection', props, statics);
            if (!props.name) return Utils.extend.call(this, 'View', props, statics);
            if (views[props.name]) error('A View\'s name must be unique', props.name, props, statics);
            return views[props.name] = Utils.extend.call(this, 'V_' + props.name, props, statics);
        };
        _.extend(View.prototype, Events);

        return View;
    });