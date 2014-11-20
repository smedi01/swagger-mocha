'use strict';

var request = require('supertest');
var expect = require('expect.js');
var async = require('async');
var tv4 = require('tv4');
var formats = require('./format-validators');

tv4.addFormat(formats);

var SwaggerMocha = module.exports = function SwaggerMocha(app, swaggerPath) {
    this.baseURL = app;
    this.request = request(app);
    this.swaggerPath = swaggerPath || '/swagger.json';
};

SwaggerMocha.run = function(callback) {
    mocha.run(callback);
}

SwaggerMocha.prototype.before = function(callback) {
    before(callback);
}

SwaggerMocha.prototype.run = function(callback) {
    var self = this;

    async.series([
        this.getSwaggerJson.bind(this),
        this.setDefinitions.bind(this),
        this.getResults.bind(this),
        this.testResults.bind(this)
    ], function(err) {
        if (err) {
            throw err;
        }

        callback();
    });
};

SwaggerMocha.prototype.getSwaggerJson = function(callback) {
    var self = this;

    console.log('Fetching spec at ' + this.swaggerPath);

    this.request
        .get(self.swaggerPath)
        .expect(200)
        .end(function(err, res) {
            if (err) {
                console.log(err);
                err = new Error('Could not find swagger.json at ' +
                    self.swaggerPath);
            } else {
                self.swagger = res.body;
            }

            if (self.swagger.basePath.indexOf('path') !== -1) {
                var apis = [];
                var lastCalledIndex = 0;

                for (var apiIndex in self.swagger.apis) {
                    var tests = new SwaggerMocha(self.baseURL,
                        '/docs?path=' + self.swagger.apis[apiIndex]
                        .path);
                    tests.validParams = self.validParams;
                    tests.customRequests = self.customRequests;
                    apis.push(tests);
                }

                var loadNextAPI = function() {
                    if (lastCalledIndex + 1 <= apis.length) {
                        apis[lastCalledIndex].run(loadNextAPI);
                        lastCalledIndex++;
                    }
                }
                loadNextAPI();

                return;
            }

            callback(err);
        });
};

SwaggerMocha.prototype.setDefinitions = function(callback) {
    var models = this.swagger.models;


    if (models) {
        console.log('Parsing models');

        Object.keys(models).forEach(function(name) {
            tv4.addSchema('#/models/' + name, models[name]);
        });
    } else {
        console.log('No models found');
    }


    if (callback) {
        callback();
    }
};

SwaggerMocha.prototype.getResults = function(callback) {
    var self = this;
    var apis = this.swagger.apis;
    //## For now only support GET and status 200
    var status = 200;
    var testedPaths = [];

    apis.forEach(function(apiElement, apiIndex, apiArray) {

        apiElement.operations.forEach(function(operationElement,
            operationIndex, operationArray) {

            testedPaths.push({
                requestUrl: self.fullPath(self.setPathParams(
                    apiElement.path,
                    operationElement.parameters
                )),
                path: self.setPathParams(apiElement
                    .path, operationElement.parameters
                ),
                status: status,
                method: operationElement.method.toLowerCase()
            });

        });
    });

    testedPaths = testedPaths.concat(this.customRequests || []);

    console.log('Fetching results');

    async.map(testedPaths, function(data, next) {
        self.generateValidRequest(data, data)
            .set('Content-Type', 'application/json')
            .set('authorization',
                'Token=BEA46B8C25A446F1B12E792B61524192')

        .expect(data.status)
            .end(function(err, res) {
                if (err) {
                    return next('Could not find ' +
                        data.method + ' at ' + data.requestUrl +
                        '. Reason: ' + err.message);
                }

                data.result = res.body;
                data.headers = res.headers;
                setTimeout(function() {
                    next(null, data);
                }, 0)

            });
    }, function(err, results) {
        self.results = results;
        callback(err);
    });
};

SwaggerMocha.prototype.generateValidRequest = function(data, spec) {
    //## Set query params and stuff
    return this.request[data.method || 'get'](data.path);
};

SwaggerMocha.prototype.fullPath = function(path) {
    return (this.swagger.basePath || '') + path;
};

SwaggerMocha.prototype.setPathParams = function(path, parameters) {
    var self = this;

    if (!parameters || !parameters.length) {
        return path;
    }

    parameters.forEach(function(param) {
        if (param.paramType === 'path') {
            path = path.replace(new RegExp('\{' + escapeRegExp(
                param.name) + '\}'), self.validParams[param
                .name]);
        }
    });

    return path;
};

SwaggerMocha.prototype.testResults = function(callback) {
    var self = this;

    console.log('Matching results against schemas');

    this.results.forEach(function(test) {
        var path = self.swagger.paths[test.path];
        var schema = path[test.method].responses[test.status].schema;
        var headerSchemas = path[test.method].responses[test.status]
            .headers;

        describe(test.method.toUpperCase() + ' ' + test.requestUrl,
            function() {
                describe('response body', function() {
                    self.testResult(test.result, schema,
                        test.customTest, self.banUnknownProperties
                    );
                });

                if (headerSchemas) {
                    describe('response headers', function() {
                        self.testResult(test.headers, {
                            properties: keysToLowerCase(
                                headerSchemas
                            ),
                            required: getRequiredHeaders(
                                headerSchemas
                            )
                        }, null, self.banUnknownHeaders);
                    });
                }
            });
    });

    if (callback) {
        callback();
    }
};

SwaggerMocha.prototype.testResult = function(result, schema, customTest,
    banUnknownProperties) {
    var assertion = tv4.validateMultiple(result, schema, false,
        banUnknownProperties);

    if (!assertion.valid) {
        assertion.errors.forEach(function(err) {
            it(err.dataPath, function() {
                throw err;
            });
        });
    } else if (!customTest) {
        it('looks alright!', function() {});
    }

    if (customTest) {
        customTest(result);
    }
};

/* Helpers
============================================================================= */

function escapeRegExp(string) {
    return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');
}


function keysToLowerCase(obj) {
    var result = {};

    Object.keys(obj).forEach(function(key) {
        result[key.toLowerCase()] = obj[key];
    });

    return result;
}

function getRequiredHeaders(headerSchemas) {
    return Object.keys(headerSchemas || {}).filter(function(key) {
        return headerSchemas[key].required;
    }).map(String.prototype.toLowerCase.call.bind(String.prototype.toLowerCase));
}
