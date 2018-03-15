class Action {
  constructor(type, verb, handler) {
    this._type = type;
    this._verb = verb;
    this._handler = handler;
  }

  get type() {
    return this._type;
  }

  get verb() {
    return this._verb;
  }

  get bodySchema() {
    return this._jsonSchemaRef;
  }

  setBodySchema(value) {
    this._jsonSchemaRef = value;
    return this;
  }
}

class CollectionAction extends Action {
  constructor(verb, handler) {
    super('collection', verb, handler);
  }

  handle(body) {
    return this._handler(body);
  }
}

class InstanceAction extends Action {
  constructor(verb, handler) {
    super('instance', verb, handler);
    this._loadInstance = true;
  }

  get loadInstance() {
    return this._loadInstance;
  }

  setLoadInstance(value) {
    this._loadInstance = value;
    return this;
  }

  handle(id, body) {
    return this._handler(id, body);
  }
}

module.exports = {
  CollectionAction,
  InstanceAction,
};
