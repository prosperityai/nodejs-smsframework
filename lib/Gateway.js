'use strict';

var express = require('express'),
    events = require('events'),
    util = require('util'),
    Q = require('q'),
    _ = require('lodash'),
    mdata = require('./data')
    ;

/** SMS Gateway
 *
 * @fires {Gateway#msg-in}  Incoming message.  Arguments: IncomingMessage
 * @fires {Gateway#msg-out} Outgoing message.  Arguments: OutgoingMessage
 * @fires {Gateway#status}  Status report.     Arguments: MessageStatus
 * @fires {Gateway#error}   Errors.            Arguments: Error
 *
 * @constructor
 * @extends {events.EventEmitter}
 */
var Gateway = exports.Gateway = function(){
    /** Registered providers
     * @type {Object.<String, IProvider>}
     * @protected
     */
    this._providers = {};

    /** Express application for SMS receivers
     * @type {express}
     * @protected
     */
    this._express = express();
};
util.inherits(Gateway, events.EventEmitter);



//region Providers

/** Add a provider class.
 * Its receivers will be available under /<alias>/: see provider documentation.
 * @param {Function} Provider
 *      Provider constructor
 * @param {String} alias
 *      Provider alias
 * @param {Object} config
 *      Provider-dependent configuration
 * @returns {Gateway}
 */
Gateway.prototype.addProviderClass = function(Provider, alias, config){
    // Express
    var app = express();
    this._express.use(alias, app);

    // Provider
    var provider = (function(constructor, args){
        // see: http://stackoverflow.com/a/14378462/134904
        var instance = Object.create(constructor.prototype);
        var result = constructor.apply(instance, args);
        return typeof result === 'object' ? result : instance;
    })(Provider, [ this, alias, config || {}, app ]);

    // Receivers
    var self = this;

    // Finish
    this._providers[alias] = provider;
    return this;
};

/** Add a provider by name
 *
 * Usage:
 *      addProvider(name, alias, config);
 *      addProvider({ alias: { provider: name, config: config } })
 *
 * @param {String|Object.<String, { provider: String, config: Object }>} provider
 *      Provider name ( from ./providers )
 *      OR an object of providers
 * @param {String} alias
 *      Provider alias
 * @param {Object} config
 * @returns {Gateway}
 */
Gateway.prototype.addProvider = function(provider, alias, config){
    // footprint: addProvider(providers)
    if (_.isObject(provider)){
        var self = this;
        _.each(provider, function(data, alias){
            self.addProvider(data.provider, alias, data.config);
        });
        return this;
    }

    // footprint: addProvider(provider, alias, config)
    var Provider = require('./providers')[provider];
    if (_.isUndefined(Provider))
        throw new Error('Unknown provider name: ' + provider);

    // Add provider
    return this.addProviderClass(Provider, alias, config);
};

/** Get a provider by alias
 * You don't need this, unless the provider has some public API: see provider documentation.
 * @param {String} alias
 *      Provider alias
 * @returns {IProvider?}
 */
Gateway.prototype.getProvider = function(alias){
    return this._providers[alias];
};

//endregion



//region Provider Integration

/** Handle an Incoming Message.
 * Internal method used by providers
 * @param {IncomingMessage} message
 *      The message to handle
 * @returns {Q} promise
 *      When the handler fails, provider should report an error to the service
 * @protected
 */
Gateway.prototype.receiveMessage = function(message){
    var self = this;
    return [
        // Emit 'msg-in'
        function(){
            self.emit('msg-in', message);
        }
    ].reduce(Q.when, Q(1));
};

/** Handle a message Status.
 * Internal method used by providers
 * @param {MessageStatus} status
 *      Status of some outgoing message
 * @returns {Q} promise
 *      When the handler fails, provider should report an error to the service
 * @protected
 */
Gateway.prototype.receiveStatus = function(status){
    var self = this;
    return [
        // Emit 'status'
        function(){
            self.emit('status', status);
        }
    ].reduce(Q.when, Q(1));
};

//endregion



//region Send

/** Send a message
 * This is a low-level interface that requires you to prepare an OutgoingMessage object
 * @param {OutgoingMessage} message
 *      The message to send
 * @returns {Q} promise
 * @throws {Error} Unknown provider alias (promised)
 */
Gateway.prototype.sendMessage = function(message){
    var self = this;
    return [
        // Emit 'msg-out'
        function(){
            self.emit('msg-out', message);
        },
        // Send it
        function(){
            // Provider
            var provider = this._providers[message.provider];
            if (!provider)
                throw new Error('Unknown provider alias: ' + message.provider);

            // Send it
            return Q(provider.send(message))
                // Emit errors
                .catch(function(err){
                    self.emit('error', err); // emit
                    throw err; // Throw it further
                });
        }
    ].reduce(Q.when, Q(1));
};
//endregion