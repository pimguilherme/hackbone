define(function (require, exports, module) {

    _.extend(exports, {

        Model:require('./Model'),
        APITransport:require('./APITransport'),
        ModelRegistry:require('./ModelRegistry'),
        HashSanidator:require('./HashSanidator'),

        Collection:require('./Collection'),

        View:require('./View'),
        ViewBinder:require('./ViewBinder'),

        Events:require('./Events'),
        History:require('./History'),
        Router:require('./Router'),
        Utils:require('./Utils'),
        Module: require('./Module')
    })

})