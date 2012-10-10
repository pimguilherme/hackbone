define(
    [
        'jquery',
        'underscore',
        'lib/Backbone/Events',
        'lib/Backbone/History'
        // Modules
        // Views
    ],
    function ($, _, Events, History) {

        // Routers map faux-URLs to actions, and fire events when routes are
        // matched. Creating a new one sets its `routes` hash, if not set statically.
        var Router = function (options) {
            options || (options = {});
            if (options.routes) this.routes = options.routes;
            this._bindRoutes();
            this.initialize.apply(this, arguments);
        };

        // Cached regular expressions for matching named param parts and splatted
        // parts of route strings.
        var namedParam = /:\w+/g
            , splatParam = /\*\w+/g
            , escapeRegExp = /[-[\]{}()+?.,\\^$|#\s]/g
            ;

        Router.prototype = {

            // Initialize is an empty function by default. Override it with your own
            // initialization logic.
            initialize:function () {},

            // Manually bind a single named route to a callback. For example:
            //
            //     this.route('search/:query/p:num', 'search', function(query, num) {
            //       ...
            //     });
            //
            route:function (route, name, callback) {
                History.instance || (History.instance = new History);
                if (!_.isRegExp(route)) route = this._routeToRegExp(route);
                if (!callback) callback = this[name];
                History.instance.route(route, _.bind(function (fragment) {
                    var args = this._extractParameters(route, fragment);
                    callback && callback.apply(this, args);
                    this.trigger.apply(this, ['route:' + name].concat(args));
                    History.instance.trigger('route', this, name, args);
                }, this));
                return this;
            },

            // Simple proxy to `History.instance` to save a fragment into the history.
            navigate:function (fragment, options) {
                History.instance.navigate(fragment, options);
            },

            // Bind all defined routes to `History.instance`. We have to reverse the
            // order of the routes here to support behavior where the most general
            // routes can be defined at the bottom of the route map.
            _bindRoutes:function () {
                if (!this.routes) return;
                var routes = [];
                for (var route in this.routes) {
                    routes.unshift([route, this.routes[route]]);
                }
                for (var i = 0, l = routes.length; i < l; i++) {
                    this.route(routes[i][0], routes[i][1], this[routes[i][1]]);
                }
            },

            // Convert a route string into a regular expression, suitable for matching
            // against the current location hash.
            _routeToRegExp:function (route) {
                route = route.replace(escapeRegExp, '\\$&')
                    .replace(namedParam, '([^\/]+)')
                    .replace(splatParam, '(.*?)');
                return new RegExp('^' + route + '$');
            },

            // Given a route, and a URL fragment that it matches, return the array of
            // extracted parameters.
            _extractParameters:function (route, fragment) {
                return route.exec(fragment).slice(1);
            }

        };

        _.extend(Router.prototype, Events);

        return Router;

    }
);

