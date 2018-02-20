const chai = require('chai');
const chaiSubset = require('chai-subset');
const sinon = require('sinon');

global.chai = chai;
chai.use(chaiSubset);
global.sinon = sinon;
global.assert = chai.assert;
sinon.assert.expose(chai.assert, { prefix: '' });

beforeEach(() => {
  global.sandbox = global.sinon.sandbox.create();
  global.spy = global.sandbox.spy.bind(global.sandbox);
  global.stub = global.sandbox.stub.bind(global.sandbox);
});

afterEach(() => {
  global.sandbox.restore();
});
