define(function (require) {

    var Events = require('./Events')
        , error = require('./Utils').scopedError('Module')
        , _ = require('underscore')
        , extractRequestInfo = function (s) {
            try {

                var module = s.split('.')[0]
                    , state = s.split('.')[1]
                    , namePos = state.lastIndexOf('/')
                    , name = ~namePos ? state.substring(0, namePos) : 'status'
                    , value = ~namePos ? state.substring(namePos + 1) : state
                return {module:module, name:name, value:value}

            } catch (e) {
                error("Invalid module identifier", s)
            }
        }

    var Module = function (name) {
        this.name = name;
        this.states = {}
    }

    Module.prototype = {

        error:function (e) {
            console.error.call(console, 'Module/' + this.name + ": " + e, Array.prototype.slice.call(arguments, 1));
            throw 'Module/' + this.name + ": " + e
        },

        log:function (e) {
            console.log.call(console, 'Module/' + this.name + ": " + e, Array.prototype.slice.call(arguments, 1));
        },

        extend:function () {
            return _.extend.apply(_, [this].concat(arguments))
        },

        //
        // States
        //
        if:function (name, f) {
            var info = extractRequestInfo(name)
                , module = Modules.get(info.module)

            if (!module) {
                this.error('Module not yet loaded', name)
            }

            if (!f) return module.states[info.name] == info.val
            if (module.states[info.name] == info.val) {
                f()
            }
        },

        when:function (name, f) {
            var info = extractRequestInfo(name)
                , module = Modules.get(info.module)

            if (!module) {
                this.log('WARNING: Module being watched not yet loaded', name)
            }

            Events.on.call(PubSub, name, f)
        },

        getState:function (name) {
            return this.states[name || 'status']
        },

        //
        // Event Bus
        //

        // Retorna o nome completo para o estado
        _completeName:function (name) {
            return this.name + '.' + name;
        },

        // Dispara uma mensagem PubSub indicando o estado do módulo
        state:function (val) {

            var namePos = val.lastIndexOf('/')
                , name = ~namePos ? val.substring(0, namePos) : 'status'
                , value = ~namePos ? val.substring(namePos + 1) : val
                , oldVal = val
            this.states[name] = value

            arguments[0] = this._completeName(val);
            busLog('? ' + this.name + ':', oldVal, arguments[0]);
            Events.trigger.apply(PubSub, arguments)
        },

        react:function (name) {
            arguments[0] = this._completeName(name);
            Events.on.apply(PubSub, arguments)
        },

        demand:function (name) {
            var info = extractRequestInfo(name)
                , module = Modules.get(info.module)

            if (!module) {
                this.log('WARNING: Module demanded not yet loaded', name)
            }
            busLog('! ' + this.name + ':', name);
            Events.trigger.apply(PubSub, arguments)
        }

    }


    //
    // PubSub
    //

    // Logger das mensagens PubSub
    var busLog = function (action, name, fullName) {
        if (!name) {
            name = action;
            action = '*';
        }
        if (!fullName) {
            fullName = name
        }
        var callbacks = [], callback;
        if (PubSub._callbacks && (callback = PubSub._callbacks[fullName])) {
            while ((callback = callback.next) && callback.next) { callbacks.push(callback.callback) }
        }
        console.log('[Module ' + (Date.create().format('{hh}:{mm}:{ss}')) + '] ' + callbacks.length + ' ' + action + ' ' + name);
    };

    var PubSub = {
        publish:function (name) {
            busLog(name);
            Events.trigger.apply(PubSub, arguments);
        },
        on:Events.on,
        off:Events.off
    };


    var Modules = function (name) {
        if (!Modules._modules[name]) {
            error("Module not yet loaded", name)
        }
        return Modules._modules[name];
    }

    _.extend(Modules, {
        create:function (name) {
            if (this._modules[name]) {
                error("Module already defined", name)
            }
            return this._modules[name] = new Module(name)
        },
        get:function (name) {
            return this._modules[name]
        },
        _modules:{}
    });

    return Modules;

})