const _ = require('lodash');

class ResourceServer {
  static _parseRequest(rawRequest) {
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

  constructor(natsClient, name, options) {
    this._natsClient = natsClient;
    this._name = name;

    this._logger = options.logger;
    this._collectionActions = options.collectionActions;
    this._instanceActions = options.instanceActions;
  }

  start() {
    const options = {
      queue: 'rest',
    };
    _.forOwn(this._collectionActions, (handler, verb) => {
      const subject = `${this._name}.collection.${verb}`;
      this._debug(`NATS subscribe ${subject}`);
      this._natsClient.subscribe(`${subject}`, options, (rawRequest, replyTo) => {
        this._debug(`NATS REC ${subject} -> ${rawRequest}`);
        this._handleCollectionAction(verb, rawRequest, replyTo, handler);
      });
    });

    _.forOwn(this._instanceActions, (handler, verb) => {
      const subject = `${this._name}.instance.${verb}`;
      this._debug(`NATS subscribe ${subject}`);
      this._natsClient.subscribe(`${subject}`, options, (rawRequest, replyTo) => {
        this._debug(`NATS REC ${subject} -> ${rawRequest}`);
        this._handleInstanceAction(verb, rawRequest, replyTo, handler);
      });
    });
  }

  emit(message) {
    const rawMessage = JSON.stringify(message);
    this._debug(`NATS EMIT ${this._name} <- ${rawMessage}`);
    this._natsClient.publish(this._name, rawMessage);
  }

  _handleCollectionAction(verb, rawRequest, replyTo, handler) {
    return ResourceServer._parseRequest(rawRequest)
      .then(request => handler(request.body))
      .then(result => this._sendResponse(replyTo, result))
      .catch(error => this._sendError(replyTo, error));
  }

  _handleInstanceAction(verb, rawRequest, replyTo, handler) {
    return ResourceServer._parseRequest(rawRequest)
      .then(request => handler(request.id, request.body))
      .then(result => this._sendResponse(replyTo, result))
      .catch(error => this._sendError(replyTo, error));
  }

  _sendResponse(replyTo, result) {
    const response = JSON.stringify({
      status: 200,
      body: result,
    });
    this._debug(`NATS PUB ${replyTo} <- ${response}`);
    this._natsClient.publish(replyTo, response);
  }

  _sendError(replyTo, error) {
    if (this._logger) {
      this._logger.error(error);
    }
    const response = {
      status: 500,
      message: 'Internal Server Error',
    };
    if (error.statusCode) {
      response.status = error.statusCode;
      response.message = error.message;
    }
    const rawResponse = JSON.stringify(response);
    this._debug(`NATS PUB ${replyTo} <- ${rawResponse}`);
    this._natsClient.publish(replyTo, rawResponse);
  }

  _debug(message) {
    if (this._logger) {
      this._logger.debug(message);
    }
  }
}

module.exports = ResourceServer;
