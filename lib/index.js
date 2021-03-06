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
    this.results = [];
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
                self.getResults.bind(self)
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
            var lastCalledIndex = APIOutline.apis.length;

            for (var apiIndex in APIOutline.apis) {
                (function(apiIndex) {
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
                })(apiIndex);
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

    // Loop through the API versions
    Object.keys(this.swagger).forEach(function(apiVersion) {
        var apis = self.swagger[apiVersion].apis;
        var models = self.swagger[apiVersion].models;

        describe('API v' + apiVersion, function() {

            describe('Standard requests', function() {
                // loop through the endpoints
                apis.forEach(function(apiElement) {
                    // loop throguh the methods (aka operations, including spec)
                    apiElement.operations.forEach(function(operationElement) {
                        // Get the schemas.
                        var schema = models[operationElement.type];

                        // Set up the test.
                        it("should respond without error to a " + operationElement.method + " on the " + apiElement.path + " endpoint", function(done) {

                            // Build the request
                            self.generateValidRequest(
                                self.setPathParams(apiElement.path, operationElement.parameters),
                                operationElement,
                                apiVersion)
                                .end(function(err, res) {
                                    // Expect there to be no error.
                                    expect(err).to.not.be.ok;

                                    // TODO: support more then status 2xx blindly
                                    expect(res.statusCode).to.match(/^2[0-9]{2}$/);

                                    // If a schema is present, validate against it.
                                    if (schema) {
                                        describe('response body', function() {
                                            it(apiElement.path + ' response body should match schema', function() {
                                                self.testResult(res.body, schema,
                                                    test.customTest, self.banUnknownProperties
                                                );
                                            });
                                        });
                                    }

                                    // We're done here.
                                    done();
                            });
                        });
                    });
                });
            });
        });
    });

    callback();

};

SwaggerMocha.prototype.generateValidRequest = function(path, spec, apiVersion) {

    //## Set query params and stuff
    var request = this.request[spec.method.toLowerCase() || 'get'](path);

    // Inject content type headers based on API spec
    for(var contentType in spec.consumes) {
        request.set('Content-Type', spec.consumes[contentType]);
    }

    if(spec.method.toLowerCase() !== 'get') {
        var body = this.bodyBuilder(spec.parameters, this.swagger[apiVersion].models);
        request = request.send(body);
    }

    // FIXME: dont hard code auth token in lib
    request.set('Authorization', 'Token BEA46B8C25A446F1B12E792B61524192')

    return request;

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

SwaggerMocha.prototype.bodyBuilder = function(parameters, models) {
    var self = this;
    var body = {};

    if (!parameters || !parameters.length) {
        return body;
    }

    parameters.forEach(function(mainParam) {
        if (mainParam.paramType === 'body') {

            Object.keys(models[mainParam.type].properties).forEach(function(name) {
                body[name] = self.validParams[name];
            });

        }
    });

    return body;
};

SwaggerMocha.prototype.testResult = function(result, schema, customTest,
banUnknownProperties) {

    var assertion = tv4.validateMultiple(result, schema, false, banUnknownProperties);

    if (!assertion.valid) {
        assertion.errors.forEach(function(err) {
            it(err.dataPath, function(done) {
                if (err) {
                    throw err;
                }
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
