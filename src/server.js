const _ = require('lodash');

class ResourceServer {
  constructor(natsClient, name, handlers, logger) {
    this._natsClient = natsClient;
    this._name = name;
    this._handlers = handlers;
    this._logger = logger;
  }

  start() {
    const options = {
      queue: 'rest',
    };
    _.forOwn(this._handlers, (handler, verb, object) => {
      this._natsClient.subscribe(`${this._name}.${verb}`, options, (rawRequest, replyTo) => {
        this._debug(`NATS REC ${this._name}.${verb} -> ${rawRequest}`);
        this._receive(verb, rawRequest, replyTo, handler);
      });
    });
  }

  emit(message) {
    const rawMessage = JSON.stringify(message);
    this._debug(`NATS EMIT ${this._name} <- ${rawMessage}`);
    this._natsClient.publish(this._name, rawMessage);
  }

  _receive(verb, rawRequest, replyTo, handler) {
    return this._parseRequest(rawRequest)
      .then((request) => {
        return handler(request.id, request.body);
      })
      .then((result) => {
        const response = JSON.stringify({
          status: 200,
          body: result,
        });
        this._debug(`NATS PUB ${replyTo} <- ${response}`);
        this._natsClient.publish(replyTo, response);
      })
      .catch((err) => {
        if (this._logger) {
          this._logger.error(err);
        }

        const response = {
          status: 500,
          message: 'Internal Server Error',
        };
        if (err.statusCode) {
          response.status = err.statusCode;
          response.message = err.message;
        }
        const rawResponse = JSON.stringify(response);
        this._debug(`NATS PUB ${replyTo} <- ${rawResponse}`);
        this._natsClient.publish(replyTo, rawResponse);
      });
  }

  _parseRequest(rawRequest) {
    return new Promise((resolve, reject) => {
      try {
        const request = JSON.parse(rawRequest);
        resolve(request);
      } catch (err) {
        const newErr = new Error('JSON parse error');
        reject(newErr);
      }
    });
  }

  _debug(message) {
    if (this._logger) {
      this._logger.debug(message);
    }
  }
}

module.exports = ResourceServer;
