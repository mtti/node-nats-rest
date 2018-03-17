const _ = require('lodash');
const bodyParser = require('body-parser');
const express = require('express');
const nats = require('nats');
const createError = require('http-errors');
const ResourceSubscription = require('./subscription');

const jsonParser = bodyParser.json();

class ResourceClient {
  /**
   * Creates a microservice plugin which initializes resource clients for a list of resource
   * names.
   * @param {string[]} resourceNames
   * @param {Object} options
   */
  static plugin(resourceNames, options = {}) {
    return {
      init(service) {
        const resourceClients = resourceNames
          .map((name) => {
            const resourceOptions = {
              logger: service.logger,
            };
            _.merge(resourceOptions, options);

            const key = `${name}Client`;
            if (service[key]) {
              throw new Error(`Can't create ResourceClient: service.${key} is already in use`);
            }

            const client = new ResourceClient(
              service.natsClient,
              name,
              resourceOptions,
            );
            return [key, client];
          });

        _.merge(service, _.fromPairs(resourceClients));
      }
    };
  }

  constructor(natsClient, name, options = {}) {
    this._natsClient = natsClient;
    this._name = name;

    if (options.logger) {
      this._logger = options.logger;
    }
  }

  /**
   * An express proxy to the resource.
   */
  get proxy() {
    if (!this._proxy) {
      this._proxy = (req, res) => {
        const verb = req.method;
        const { id } = req.params;

        this.request(verb, id, req.body)
          .then((result) => {
            res.json(result);
          })
          .catch((err) => {
            if (err.statusCode) {
              res.status(err.statusCode);
            } else {
              res.status(500);
            }
            res.end();
          });
      };
    }
    return this._proxy;
  }

  /**
   * An Express router which can be used to proxy HTTP requests to the resource server over NATS.
   * Comes configured with default routes for the GET, PUT, PATCH and DELETE verbs.
   */
  get router() {
    if (!this._router) {
      this._router = express.Router();
      this._router.get('/:id', this.proxy);
      this._router.put('/:id', jsonParser, this.proxy);
      this._router.patch('/:id', jsonParser, this.proxy);
      this._router.delete('/:id', this.proxy);
    }
    return this._router;
  }

  /**
   * Adds collection action routes to the internal Express router.
   * @param {Array} verbs
   */
  routeCollectionActions(verbs) {
    verbs.forEach((verb) => {
      this.router.post(`/${verb}`, jsonParser, this._proxyAction(verb));
    });
    return this;
  }

  /**
   * Adds instance action routes to the internal Express router.
   * @param {Array} verbs
   */
  routeInstanceActions(verbs) {
    verbs.forEach((verb) => {
      this.router.post(`/:id/${verb}`, jsonParser, this._proxyAction(verb));
    });
    return this;
  }

  /**
   * Perform a GET request.
   * @param {*} id
   */
  get(id) {
    return this.request('GET', id);
  }

  /**
   * Perform a PUT request.
   * @param {*} id
   * @param {*} body
   */
  put(id, body) {
    return this.request('PUT', id, body);
  }

  /**
   * Perform a PATCH request.
   * @param {*} id
   * @param {*} body
   */
  patch(id, body) {
    return this.request('PATCH', id, body);
  }

  /**
   * Perform a DELETE request.
   * @param {*} id
   */
  delete(id) {
    return this.request('DELETE', id);
  }

  /**
   * Perform a custom request.
   * @param {*} verb
   * @param {*} id
   * @param {*} body
   */
  request(verb, id, body) {
    const request = {};

    if (id) {
      request.id = id;
    }
    if (body) {
      request.body = body;
    }

    let subject;
    if (id) {
      subject = `${this._name}.instance.${verb}`;
    } else {
      subject = `${this._name}.collection.${verb}`;
    }

    return new Promise((resolve, reject) => {
      this._debug(`NATS requestOne ${subject}`);
      this._natsClient.requestOne(subject, JSON.stringify(request), {}, 1000, (rawResponse) => {
        if (rawResponse.code && rawResponse.code === nats.REQ_TIMEOUT) {
          reject(createError(504));
          return;
        }

        const response = JSON.parse(rawResponse);

        if (response.status >= 400) {
          reject(createError(response.status, response.message));
          return;
        }

        resolve(response.body);
      });
    });
  }

  subscribe(cb) {
    const sid = this._natsClient.subscibe(`${this._name}`, (rawMessage) => {
      const message = JSON.parse(rawMessage);
      cb(message);
    });
    return new ResourceSubscription(this._natsClient, sid);
  }

  _proxyAction(verb) {
    return (req, res) => {
      this.request(verb, req.params.id, req.body)
        .then((result) => {
          res.json(result);
        })
        .catch((err) => {
          if (err.statusCode) {
            res.status(err.statusCode);
          } else {
            res.status(500);
          }
          res.end();
        });
    };
  }

  _debug(message) {
    if (this._logger) {
      this._logger.debug(message);
    }
  }
}

module.exports = ResourceClient;
