/*
 * Copyright (c) 2011 Vinay Pulim <vinay@milewise.com>
 * MIT Licensed
 */

'use strict';

var url = require('url');
var req = require('request');
var debug = require('debug')('node-soap');
var fs = require('fs');

var querystring = require('querystring');
var http = require('http');
var formidable = require('formidable');

var VERSION = require('../package.json').version;

/**
 * A class representing the http client
 * @param {Object} [options] Options object. It allows the customization of
 * `request` module
 *
 * @constructor
 */
function HttpClient(options) {
  options = options || {};
  this._request = options.request || req;
}

/**
 * Build the HTTP request (method, uri, headers, ...)
 * @param {String} rurl The resource url
 * @param {Object|String} data The payload
 * @param {Object} exheaders Extra http headers
 * @param {Object} exoptions Extra options
 * @returns {Object} The http request object for the `request` module
 */
HttpClient.prototype.buildRequest = function (rurl, data, exheaders, exoptions) {
  var curl = url.parse(rurl);
  var secure = curl.protocol === 'https:';
  var host = curl.hostname;
  var port = parseInt(curl.port, 10);
  var path = [curl.pathname || '/', curl.search || '', curl.hash || ''].join('');
  var method = data ? 'POST' : 'GET';
  var headers = {
    'User-Agent': 'node-soap/' + VERSION,
    //'Accept': 'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
    //'Accept-Encoding': 'none',
    //'Accept-Charset': 'utf-8',
    'Connection': 'close',
    'Host': host + (isNaN(port) ? '' : ':' + port)
  };
  var attr;
  var header;
  var mergeOptions = ['headers'];

  var mainContent = {};

  if (typeof data === 'string') {
    mainContent['Content-Length'] = Buffer.byteLength(data, 'utf8');
    mainContent['Content-Type'] = 'text/xml; charset=UTF-8';
  }

  exheaders = exheaders || {};
  for (attr in exheaders) {
    headers[attr] = exheaders[attr];
  }

  var options = {
    uri: curl,
    method: method,
    headers: headers,
    followAllRedirects: true
  };

  if (data) {
    mainContent.body = data;
    options.multipart = options.multipart || [];
    options.multipart.push(mainContent);
  }

  /*if (headers.Connection === 'keep-alive') {
    options.body = data;
  }*/

  exoptions = exoptions || {};
  for (attr in exoptions) {
    if (mergeOptions.indexOf(attr) !== -1) {
      for (header in exoptions[attr]) {
        options[attr][header] = exoptions[attr][header];
      }
    } else {
      options[attr] = exoptions[attr];
    }
  }
  debug('Http request: %j', options);
  return options;
};

/**
 * Handle the http response
 * @param {Object} The req object
 * @param {Object} res The res object
 * @param {Object} body The http body
 * @param {Object} The parsed body
 */
HttpClient.prototype.handleResponse = function (req, res, body) {
  debug('Http response body: %j', body);
  if (typeof body === 'string') {
    // Remove any extra characters that appear before or after the SOAP
    // envelope.
    var match =
      body.replace(/<!--[\s\S]*?-->/, "").match(/(?:<\?[^?]*\?>[\s]*)?<([^:]*):Envelope([\S\s]*)<\/\1:Envelope>/i);
    if (match) {
      body = match[0];
    }
  }
  return body;
};

HttpClient.prototype.request = function (rurl, data, callback, attachments, attachmentDirectory, exheaders, exoptions) {
  var self = this;
  var options = self.buildRequest(rurl, data, exheaders, exoptions);
  var headers = options.headers;

  if (attachments) {
    attachments.forEach(function (attachment) {
      options.multipart.push({
        "Content-ID": attachment.filename,
        body: fs.createReadStream(attachment.path)
      })
    });
  }

  var fields = {};
  var files = {};

  var post_data = querystring.stringify(data);

  // An object of options to indicate where to post to
  var post_options = options;

  var form = new formidable.IncomingForm({
    maxFieldsSize: 1000 * 1024 * 1024
  });

  form.uploadDir = attachmentDirectory;

  var final_response;
  var final_request;
  var final_fields;
  var final_files;
  var final_body;

  var pending = 2;

  var finalize = function () {
    if (pending <= 0) {
      var body = self.handleResponse(final_request, final_response, final_fields.plain || "");

      callback(null, final_response, body || final_body, final_files);
    }
  };

  var req = self._request(options, function (err, res, body) {
    if (err) {
      return callback(err);
    }

    final_response = res;
    final_request = req;
    final_body = body;

    pending -= 1;
    finalize();
  }).on('response', function (response) {
    form.parse(response, function (err, local_fields, local_files) {
      final_fields = local_fields;
      final_files = local_files;

      pending -= 1;
      finalize();
    });
  });

  /*if (headers.Connection !== 'keep-alive') {
    req.end(data);
  }*/
  return req;
};

HttpClient.prototype.requestStream = function (rurl, data, exheaders, exoptions) {
  var self = this;
  var options = self.buildRequest(rurl, data, exheaders, exoptions);
  return self._request(options);
};

module.exports = HttpClient;
