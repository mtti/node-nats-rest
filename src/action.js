/** Base class for actions. */
class Action {
  constructor(type, verb, handler) {
    if (new.target === Action) {
      throw new TypeError('Cannot construct Action instances directly.');
    }

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

  get schemaRef() {
    return this._jsonSchemaRef;
  }

  set schemaRef(value) {
    this._jsonSchemaRef = value;
  }

  setSchemaRef(value) {
    this.schemaRef = value;
    return this;
  }
}

/** An action targeted at a resource collection. */
class CollectionAction extends Action {
  constructor(verb, handler) {
    super('collection', verb, handler);
  }

  handle(body) {
    return this._handler(body);
  }
}

/** An action targeted at a specific member of a collection. */
class InstanceAction extends Action {
  constructor(verb, handler) {
    super('instance', verb, handler);
    this._autoLoadMode = 'raw';
  }

  get autoLoadMode() {
    return this._autoLoadMode;
  }

  set autoLoadMode(value) {
    if (value !== false && value !== 'raw' && value !== 'json') {
      throw new Error(`Invalid autoload mode ${value}`);
    }
    this._autoLoadMode = value;
  }

  /** Chainable way of setting autoload mode. */
  setAutoLoadMode(value) {
    this.autoLoadMode = value;
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
