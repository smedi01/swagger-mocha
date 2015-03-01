# mocha Swagger tests

Automatic validation of Swagger paths schemas and responses.
Using mocha for pretty error outputting.

Supports swagger 1.2 only. Should support any REST api

## Usage

```js
var SwaggerTest = require('mocha-swagger-tests');
var app = require('../path/to/something/that/exposes/an/http/server');

var swaggerTest = new SwaggerTest({swaggerPath: '/docs.json'});

// - Optional
swaggerTest.customTest({
    requestUrl: '/resource?test-with-query-parameter=1337',
    path: '/resource',
    method: 'get',
    status: 200,
    customTest: function (result) {
      it('should be leet', function () {
        expect(result).to.be('1337');
      });
    }
});

// - Optional
swaggerTest.before = function(done) {
    // Do something to start the server, does not matter if sync or not
    swaggerTest.setApp(app);
    done();
};

// - Optional
swaggerTest.validParams = {
  resourceId: '1337'
};

// - NOT Optional
swaggerTest.run();
```

## API

### `new SwaggerTest(config)`

* `swaggerPath`, the path to the swagger.json file. Default is /swagger.json

### `SwaggerTest#customTest = function(request)`

* `request`
  * `requestUrl`, the path (plus any query strings) to test
  * `path`, the name of the specs for the path in the swagger.json file
  * `method`, which method to use (e.g. "get" or "post")
  * `status`, which status to expect. Can be used to test error responses too
  * [`customTest`], additional testing of the result, other than the automatic schema validation (e.g. the number of items etc)

### `SwaggerTest#validParams = {}`

* `validParams`, a key-value map of valid values for path parameters. When
  encountering a path like /resource/{id}, a property with the same name is
  expected to be found in `validParams`. This implementation is admittedly a bit
  fragile.

### `SwaggerTest#run(callback)`

Prepare the tests.

### `SwaggerTest.run(callback)`

Run mocha.

## Todo

* Tests
