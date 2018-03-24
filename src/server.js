const _ = require('lodash');
const Ajv = require('ajv');
const createError = require('http-errors');
const jsonpatch = require('fast-json-patch');
const { InstanceAction } = require('./action');
const jsonPatchSchema = require('./json-patch.schema.json');

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
    this._adapter = options.adapter || null;
    this._schemaRef = options.schemaRef || false;

    const getAction = new InstanceAction('GET', this._get.bind(this))
      .setAutoLoadMode('json');
    const putAction = new InstanceAction('PUT', this._put.bind(this))
      .setSchemaRef(this._schemaRef)
      .setAutoLoadMode(false);
    const patchAction = new InstanceAction('PATCH', this._patch.bind(this))
      .setSchemaRef('http://mattihiltunen.com/schemas/json-patch.json')
      .setAutoLoadMode('json');
    const deleteAction = new InstanceAction('DELETE', this._delete.bind(this))
      .setAutoLoadMode(false);

    const actions = [getAction, putAction, patchAction, deleteAction];
    if (options.actions) {
      Array.prototype.push.apply(actions, options.actions);
    }

    this._collectionActions = _.fromPairs(
      actions
        .filter(action => action.type === 'collection')
        .map(action => [action.verb, action])
    );
    this._instanceActions = _.fromPairs(
      actions
        .filter(action => action.type === 'instance')
        .map(action => [action.verb, action])
    );

    this._jsonSchemas = [ jsonPatchSchema ];
    if (options.jsonSchemas) {
      Array.prototype.push.apply(this._jsonSchemas, options.jsonSchemas);
    }
    this._ajv = new Ajv({
      schemas: this._jsonSchemas,
    });
  }

  start() {
    const options = {
      queue: 'rest',
    };
    _.forOwn(this._collectionActions, (action) => {
      const subject = `${this._name}.collection.${action.verb}`;
      this._debug(`NATS subscribe ${subject}`);
      this._natsClient.subscribe(`${subject}`, options, (rawRequest, replyTo) => {
        this._debug(`NATS REC ${subject} -> ${rawRequest}`);
        this._handleCollectionAction(action, rawRequest, replyTo);
      });
    });

    _.forOwn(this._instanceActions, (action) => {
      const subject = `${this._name}.instance.${action.verb}`;
      this._debug(`NATS subscribe ${subject}`);
      this._natsClient.subscribe(`${subject}`, options, (rawRequest, replyTo) => {
        this._debug(`NATS REC ${subject} -> ${rawRequest}`);
        this._handleInstanceAction(action, rawRequest, replyTo);
      });
    });
  }

  emit(message) {
    const rawMessage = JSON.stringify(message);
    this._debug(`NATS EMIT ${this._name} <- ${rawMessage}`);
    this._natsClient.publish(this._name, rawMessage);
  }

  _get(instance) {
    return Promise.resolve(instance);
  }

  _put(id, body) {
    return this._adapter.upsert(id, body);
  }

  _patch(instance, patch) {
    const newInstance = jsonpatch.applyPatch(instance, patch).newDocument;

    if (this._schemaRef !== false) {
      const validate = this._ajv.getSchema(this._schemaRef);
      if (!validate) {
        throw new Error('Could not find JSON schema to validate object');
      }
      if (!validate(newInstance)) {
        throw createError(400, validate.errors);
      }
    }

    return this._adapter.upsert(instance.id, newInstance)
      .then(newInstance => this._adapter.toJSON(newInstance));
  }

  _delete(id) {
    return this._adapter.delete(id);
  }

  _compileSchemas(schemas) {
    return _.mapValues(schemas, schema => this._ajv.compile(schema));
  }

  _validateBody(action, request) {
    if (!('body' in request)) {
      return request;
    }

    const jsonSchemaRef = action.schemaRef;
    if (!jsonSchemaRef) {
      if (jsonSchemaRef !== false) {
        throw createError(400, `No JSON schema found for ${action.verb}`);
      }
      return request;
    }

    const validate = this._ajv.getSchema(jsonSchemaRef);
    if (!validate(request.body)) {
      let errorMessage = '';
      if (validate.errors) {
        errorMessage = validate.errors
          .map(error => `${error.dataPath} ${error.message}`)
          .join(',');
      }

      this._logValidationErrors(validate.errors);
      throw createError(400, `Validation error: ${errorMessage}`);
    }

    return request;
  }

  _handleCollectionAction(action, rawRequest, replyTo) {
    return ResourceServer._parseRequest(rawRequest)
      .then(request => this._validateBody(action, request))
      .then(request => action.handle(request.body))
      .then(result => this._sendResponse(replyTo, result))
      .catch(error => this._sendError(replyTo, error));
  }

  _handleInstanceAction(action, rawRequest, replyTo) {
    return ResourceServer._parseRequest(rawRequest)
      .then(request => this._validateBody(action, request))
      .then((request) => {
        if (action.autoLoadMode === 'raw') {
          return this._adapter.load(request.id)
            .then((instance) => {
              if (!instance) {
                throw createError(404);
              }
              return action.handle(instance, request.body);
            });
        } else if (action.autoLoadMode === 'json') {
          return this._adapter.load(request.id)
            .then((instance) => {
              if (!instance) {
                throw createError(404);
              }
              return this._adapter.toJSON(instance);
            })
            .then(instanceJSON => action.handle(instanceJSON, request.body));
        }
        return action.handle(request.id, request.body);
      })
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

  _logValidationErrors(errors) {
    if (this._logger) {
      this._logger.warning(errors);
    }
  }
}

module.exports = ResourceServer;
