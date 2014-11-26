'use strict';

var request = require('supertest');
var expect = require('expect.js');
var async = require('async');
var assert = require('assert');
var tv4 = require('tv4');
var formats = require('./format-validators');

tv4.addFormat(formats);

var SwaggerMocha = module.exports = function SwaggerMocha(config) {
    if(!config.swaggerPath) throw "swaggerPath is a required param";

    if(config.app) {
        this.setApp(config.app);
    }

    this.swagger = {};
    this.beforeRun = false;
    this.swaggerPath = config.swaggerPath || '/swagger.json';
};
SwaggerMocha.prototype.setApp = function(app) {
    this.baseURL = app;
    this.request = request(app);
}

SwaggerMocha.run = function(callback) {
    mocha.run(callback);
}

SwaggerMocha.prototype.run = function(callback) {
    var self = this;
    self.isReady = false;

    describe('Base API', function() {
        before(function(done) {
            this.timeout(0);

            if(!self.beforeRun) {
                self.beforeRun = true;

                self.before(done);
            }

        });
        it("should serve valid Swagger API spec", function(done) {
            this.timeout(0);

            self.getSwaggerJson.apply(self, [function() {
                self.isReady = true;
                done();
            }]);
        });
        after(function(finished) {
            this.timeout(0);

            async.series([
                self.setDefinitions.bind(self),
                self.getResults.bind(self),
                self.testResults.bind(self)
            ], function(err) {
                if (err) {
                    throw err;
                }

                finished();
            });
        });

    });


};

SwaggerMocha.prototype.runBeforeCode = function(callback) {
    var self = this;

    before(function(done) {
        this.timeout(0);

        if(!self.beforeRun) {
            self.beforeRun = true;

            self.before(done);
        }
    });
}

SwaggerMocha.prototype.getSwaggerJson = function(callback) {
    var self = this;
    var APIOutline = {};

    this.request
        .get(self.swaggerPath)
        .expect(200)
        .end(function(err, res) {
            if (err) {
                err = new Error('Could not find swagger.json at ' +
                    self.swaggerPath);
            } else {
                APIOutline = res.body;
            }

            var apis = [];
            var lastCalledIndex = 0;

            for (var apiIndex in APIOutline.apis) {
                lastCalledIndex++;
                self.request.get('/docs?path=' + APIOutline.apis[apiIndex].path)
                    .expect(200)
                    .end(function(err, res) {
                        lastCalledIndex--;
                        if (err) {
                            err = new Error('Could not find swagger.json at ' +
                            self.swaggerPath);
                        } else {
                            self.swagger[APIOutline.apis[apiIndex].path] = res.body;
                        }

                        if(lastCalledIndex === 0) {
                            callback();
                        }
                    });
            }
        });
};

SwaggerMocha.prototype.setDefinitions = function(callback) {
    var models = this.swagger.models;


    if (models) {

        Object.keys(models).forEach(function(name) {
            tv4.addSchema('#/models/' + name, models[name]);
        });
    } else {

    }


    if (callback) {
        callback();
    }
};

SwaggerMocha.prototype.getResults = function(callback) {
    var self = this;
    //## For now only support GET and status 200
    var status = 200;
    var testedPaths = [];

    Object.keys(this.swagger).forEach(function(apiVersion) {
        var apis = self.swagger[apiVersion].apis;

        describe('API v' + apiVersion, function() {

            apis.forEach(function(apiElement) {
                apiElement.operations.forEach(function(operationElement, operationIndex, operationArray) {

                    it("should respond without error on the " + apiElement.path + " endpoint", function(done) {

                        var requestData = {
                            requestUrl: self.fullPath(self.setPathParams(
                                apiElement.path,
                                operationElement.parameters
                            )),
                            path: self.setPathParams(apiElement
                                .path, operationElement.parameters
                            ),
                            status: status,
                            method: operationElement.method.toLowerCase()
                        };

                        self.generateValidRequest(requestData)
                            .set('Content-Type', 'application/json')
                            .set('authorization',
                            'Token=3b9ddd93-06ab-4199-89f7-7ace5f5b4823')

                            .end(function(err, res) {
                                if (err) {
                                    return done('Could not find ' + requestData.method + ' at ' + requestData.requestUrl + '. Reason: ' + err.message);
                                }

                                done();
                                //
                                // data.result = res.body;
                                // data.headers = res.headers;
                                // setTimeout(function() {
                                //     next(null, data);
                                // }, 0)

                        });
                    });
                });
            });
        });
    });

    callback();

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
