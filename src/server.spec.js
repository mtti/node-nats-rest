const createError = require('http-errors');
const ResourceServer = require('./server');

describe('ResourceServer', () => {
  const testVerbs = ['GET', 'PUT', 'PATCH', 'DELETE'];
  let server;
  let serverOptions;
  let handler;
  let natsClient;

  beforeEach(() => {
    natsClient = {
      publish: spy(),
      subscribe: spy(),
    };

    serverOptions = {
      collectionActions: {},
      instanceActions: {},
    };
    testVerbs.forEach((verb) => {
      serverOptions.instanceActions[verb] = spy();
    });

    server = new ResourceServer(natsClient, 'dummy', serverOptions);
  });

  describe('start', () => {
    beforeEach(() => {
      server.start();
    });

    it('subscribes to the correct number of subjects', () => {
      expect(natsClient.subscribe.callCount).to.equal(testVerbs.length);
    });

    testVerbs.forEach((key) => {
      const expectedSubject = `dummy.instance.${key}`;
      it(`subscribes to ${expectedSubject}`, () => {
        assert.equal(natsClient.subscribe.calledWith(expectedSubject), true);
      });
    });
  });

  describe('_handleInstanceAction', () => {
    let request;

    beforeEach(() => {
      request = {
        id: '1234',
        body: {
          foo: 'bar',
        },
      };
    });

    describe('when handler returns resolved promise', () => {
      const result = {
        success: true,
      };

      beforeEach(() => {
        handler = sinon.stub().resolves(result);
        return server._handleInstanceAction(
          'dummyVerb',
          JSON.stringify(request),
          'replyTopic',
          handler,
        );
      });

      it('calls handler with ID and body', () => {
        assert(handler.calledWith(request.id, request.body));
      });

      it('calls natsClient.publish once', () => {
        assert(natsClient.publish.calledOnce);
      });

      it('publishes reply to correct topic', () => {
        assert(natsClient.publish.calledWith('replyTopic'));
      });

      it('response status is 200', () => {
        assert.equal(JSON.parse(natsClient.publish.getCall(0).args[1]).status, 200);
      });

      it('response body contains result from handler', () => {
        const actual = JSON.parse(natsClient.publish.getCall(0).args[1]).body;
        assert.deepEqual(actual, result);
      });
    });

    describe('when handler returns promise rejected with HTTP 404 error', () => {
      beforeEach(() => {
        handler = sinon.stub().rejects(createError(404));
        return server._handleInstanceAction(
          'dummyVerb',
          JSON.stringify(request),
          'replyTopic',
          handler,
        );
      });

      it('calls handler with ID and body', () => {
        assert(handler.calledWith(request.id, request.body));
      });

      it('calls natsClient.publish once', () => {
        assert(natsClient.publish.calledOnce);
      });

      it('publishes reply to correct topic', () => {
        assert(natsClient.publish.calledWith('replyTopic'));
      });

      it('response status is 404', () => {
        assert.equal(JSON.parse(natsClient.publish.getCall(0).args[1]).status, 404);
      });
    });

    describe('when handler returns promise rejected with regular error', () => {
      beforeEach(() => {
        handler = sinon.stub().rejects(new Error('Generic error'));
        return server._handleInstanceAction(
          'dummyVerb',
          JSON.stringify(request),
          'replyTopic',
          handler,
        );
      });

      it('calls handler with ID and body', () => {
        assert(handler.calledWith(request.id, request.body));
      });

      it('calls natsClient.publish once', () => {
        assert(natsClient.publish.calledOnce);
      });

      it('publishes reply to correct topic', () => {
        assert(natsClient.publish.calledWith('replyTopic'));
      });

      it('response status is 500', () => {
        assert.equal(JSON.parse(natsClient.publish.getCall(0).args[1]).status, 500);
      });
    });

    describe('when handler throws a regular error', () => {
      beforeEach(() => {
        handler = sinon.stub().throws(new Error('Generic thrown error'));
        return server._handleInstanceAction(
          'dummyVerb',
          JSON.stringify(request),
          'replyTopic',
          handler,
        );
      });

      it('calls handler with ID and body', () => {
        assert(handler.calledWith(request.id, request.body));
      });

      it('calls natsClient.publish once', () => {
        assert(natsClient.publish.calledOnce);
      });

      it('publishes reply to correct topic', () => {
        assert(natsClient.publish.calledWith('replyTopic'));
      });

      it('response status is 500', () => {
        assert.equal(JSON.parse(natsClient.publish.getCall(0).args[1]).status, 500);
      });
    });
  });
});
