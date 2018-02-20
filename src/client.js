const bodyParser = require('body-parser');
const express = require('express');
const nats = require('nats');
const createError = require('http-errors');
const ResourceSubscription = require('./subscription');

class ResourceClient {
  constructor(natsClient, name) {
    this._natsClient = natsClient;
    this._name = name;
  }

  /**
   * An express proxy to the resource.
   */
  get proxy() {
    if (!this._proxy) {
      this._proxy = (req, res) => {
        const verb = req.method;
        const id = req.params.id;

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
      const jsonParser = bodyParser.json();
      this._router = express.Router();
      this._router.get('/:id', this.proxy);
      this._router.put('/:id', jsonParser, this.proxy);
      this._router.patch('/:id', jsonParser, this.proxy);
      this._router.delete('/:id', this.proxy);
    }
    return this._router;
  }

  /**
   * Perform a GET request.
   * @param {*} id
   */
  get(id) {
    return request.request('GET', id);
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

    const subject = `${this._name}.${verb}`;

    return new Promise((resolve, reject) => {
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
}

module.exports = ResourceClient;
