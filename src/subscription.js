class ResourceSubscription {
  constructor(natsClient, sid) {
    this._natsClient = natsClient;
    this._sid = sid;
  }

  unsubscribe() {
    if (this._sid === null) {
      return;
    }
    this._natsClient.unsubscribe(this._sid);
    this._sid = null;
  }
}

module.exports = ResourceSubscription;
