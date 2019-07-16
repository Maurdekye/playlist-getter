let self = {
  error: (req, res, error, message) => {
    res.send(JSON.stringify({
      success: false,
      query: req.query,
      error: error,
      errorMessage: message
    }));
  },

  success: (req, res, result) => {
    res.send(JSON.stringify({
      success: true,
      result: result,
      query: req.query
    }));
  },

  get: (app, endpoint, queryargs, callback) => {
    app.get(endpoint, (req, res) => {
      for (let arg of queryargs) {
        if (!req.query[arg]) {
          self.error(req, res, 'Argument-Missing', `Query argument ${arg} missing from querystring`);
          return;
        }
      }
      callback(req, res);
    })
  }
};

module.exports = self;