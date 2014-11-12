/******************************************************************************

    Copyright (c) 2014, IQumulus LLC
    All rights reserved.
    
    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:
        * Redistributions of source code must retain the above copyright
          notice, this list of conditions and the following disclaimer.
        * Redistributions in binary form must reproduce the above copyright
          notice, this list of conditions and the following disclaimer in the
          documentation and/or other materials provided with the distribution.
        * Neither the name of the <organization> nor the
          names of its contributors may be used to endorse or promote products
          derived from this software without specific prior written permission.
    
    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
    ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
    WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
    DISCLAIMED. IN NO EVENT SHALL IQUMULUS LLC BE LIABLE FOR ANY
    DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
    (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
    LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
    ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
    SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
    
******************************************************************************/

var
    config = require('./config.json'),
    fs = require('fs'),
    http = require('http'),
    https = require('https'),
    util = require('util'),
    domain = require('domain'),
    express = require('express'),
    requester = require('request'),
    hb = require('handlebars'),
    moment = require('moment'),
    nodeDBI = require('node-dbi'),
    uuid = require('node-uuid'),
    session = require('./lib/session'),
    examiner = require('./lib/examiner'),
    argv = require('yargs').argv,
    server = express(),
    debugMode = argv.debug ? true  : false,
    listenPort = debugMode ? 4401 : config.port,
    clog = console.log,
    cerr = console.error,
    fmt = util.format,
    dbs = { },
    templates = {
        queries: { },
        rest: { }
    },
    queryInfo = { },
    legacyQinfo = { },
    plugins = { },
    sessions = { },
    queryVarRegex = /\$(\w+)/g
;


// setup Express server and routes

server.use(gateKeeper());
server.use(express.bodyParser());
server.use(express.cookieParser());
server.use(express.logger());

server.on('error', function (err) {
    cerr("GLOBAL ERROR!!!");
    cerr(err.message);
});

server.get('/', showAPI);
server.post('/auth', authenticate);


if (config.genericCRUD) {
    server.post('/db/:db/rel/:relation', addRecord);

    server.get('/db/:db/rel/:relation', getRecordList);
    server.get('/db/:db/rel/:relation/:id', getRecord);
    server.get('/db/:db/rel/:relation/:id/:subrelation', getSubRecordList);

    server.post('/db/:db/rel/:relation/:id', updateRecord);
    server.del('/db/:db/rel/:relation/:id', deleteRecord);
}


if (config.databases) {
    config.databases.forEach(
        function (db) {
            var d = domain.create();

            d.on(
                'error',
                function (e) {
                    if (e.code === '57P01' || e.code === 'PROTOCOL_CONNECTION_LOST') {
                        cerr('DB connection "%s" terminated!  Reconnecting...', db.name);
                        return connectThunk();
                    }

                    cerr('Uncaught DB error!');
                    throw e;
                }
            );

            function connectThunk () {
                dbs[db.name] = DBconnect(db);
                queryInfo[db.name] = { };

                Object.keys(db.queries).forEach(
                    function (qname) {
                        var info = examiner.examineQuery(db.queries[qname]);
                        legacyQinfo[qname] = info;
                        queryInfo[db.name][qname] = info;
                        makeQueryRoute(db.name, qname, db.queries[qname]);
                    }
                );
            }

            d.run(connectThunk);
        }
    );
}


if (config.externalServices) {
    config.externalServices.forEach(
        function (ext) {
            makeRESTroute(ext);
        }
    );
}


if (config.plugins) {
    Object.keys(config.plugins).forEach(
        function (pname) {
            var plug   = require('./plugins/' + pname),
                routes = plug.routes(config.plugins[pname])
            ;

            routes.forEach(
                function (r) {
                    var path = '/' + pname + r.path;

                    server[r.method](path, r.proc);

                    if (r.fields) {

                    }
                }
            );

            plugins[pname] = plug;
        }
    );
}


if (config.ssl.enabled) {
    var options = {
        ca: [ fs.readFileSync(config.ssl.ca) ],
        key:  fs.readFileSync(config.ssl.key),
        cert: fs.readFileSync(config.ssl.cert)
    };

    https.createServer(options, server).listen(listenPort);
} else {
    http.createServer(server).listen(listenPort);
}


console.log(
    "\nIQumulus Data Wrangler online.\n%s\n",
    moment().format('MMMM Do YYYY, h:mm:ss a')
);


// utils

function showError (e) {
    var x = { };

    [ 'name', 'length', 'severity', 'code', 'file', 'line', 'routine', ].forEach(
        function (k) {
            x[k] = e[k];
        }
    );
 
    cerr(x);
}

function gateKeeper () { 
    return function (req, res, next) {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');

        if ('OPTIONS' === req.method) {
          return res.send(200);
        }

        var token = req.param('token') || null;

        if (!token) {
            if (req.body) {
                token = req.body.token;
            }
        }

        if (token && sessions[token]) {
            req.iq = sessions[token];
        }
        else {
            req.iq = session.create(token);
        }

        return next();
    };
}

function emptyfilter (xs) {
    return xs.filter(
        function (x) {
            return x ? true : false;
        }
    );
}

function DBconnect (conf) {
    var db = new nodeDBI.DBWrapper(
        conf.type,
        {
            host: conf.host,
            database: conf.database,
            user: conf.user,
            password: conf.password
        }
    );

    db.connect();

    return db;
}

function query (db, query, args, fn) {
    db.fetchAll(
        query,
        args,
        fn
    );
}

function itsGood (res, rvals) {
    var sendMe = rvals || { };
    sendMe.ok = true;
    res.send(sendMe);
}

function sendError (res, error) {
    res.send({ ok: false, error: error });
}

function makeQueryRoute (dbname, qname, qtmpl) {
    var
        numParams = examiner.numQuestions(qtmpl),
        qvars = examiner.findQvars(qtmpl),
        qyarr = [ ]
    ;

    templates.queries[qname] = examiner.tmplify(qtmpl);

    for (var i = 1; i <= numParams; i++) {
        qyarr[i] = '/:p' + i;
    }

    function handler (req, res) {
        var args = [ ],
            qvals = { }
        ;

        var checkIt = examiner.validateQueryVars(req, qvars);

        if (checkIt.ok) {
            qvals = checkIt.results;
        }
        else {
            return sendError(res, checkIt.error);
        }

        for (var i = 1; i <= numParams; i++) {
            var val = req.param( 'p' + i );

            if (!val) {
                return sendError(res, fmt('Missing parameter: %s', 'p' + i));
            }

            args.push(val);
        }

        var qtext = (qvars.length > 0)
                  ? templates.queries[qname](qvals)
                  : qtmpl
        ;

        query(
            dbs[dbname],
            qtext,
            args,
            function (e, results) {
                if (e) {
                    return sendError(res, e);
                }

                itsGood(res, { results: results });
            }
        );
    }

    var legacyRoutePath = [ fmt('/query/%s', qname) ].concat(qyarr).join('');
    var routePath = [ fmt('/q/%s/%s', dbname, qname) ].concat(qyarr).join('');

    server.get(routePath, handler);
    server.get(legacyRoutePath, handler);
}

function makeRESTroute (foreigner) {
    var fname = foreigner.name;

    templates.rest[fname] = { };

    foreigner.routes.forEach(
        function (r) {
            var qvars = examiner.findQvars(r.localpath),
                lpath = r.localpath.replace(queryVarRegex, ':$1')
            ;

            templates.rest[fname][lpath] = hb.compile( r.path );

            server[r.method](
                [ '/ffi/', fname, lpath].join(''),
                function (req, res) {
                    var remotePath = lpath;

                    if (qvars.length > 0) {
                        var checkIt = examiner.validateQueryVars(req, qvars);

                        if (checkIt.ok) {
                            qvals = checkIt.results;
                        }
                        else {
                            return sendError(res, checkIt.error);
                        }

                        remotePath = templates.rest[fname][lpath](qvals);
                    }

                    requester({
                        method: r.method,
                        uri: foreigner.baseURI + remotePath,
                    }).pipe(res);
                }
            );
        }
    );
}


// routes

function showAPI (req, res) {
    var routes = Object.keys(server.routes).reduce(
        function (result, method) {
            result[method] = server.routes[method].map(
                function (r) {
                    var path = emptyfilter( r.path.split(/\//) );

                    if (path[0] === 'query') {
                        // legacy 

                        var qname = path[1],
                            qinfo = legacyQinfo[qname]
                        ;

                        if (!qinfo) {
                            cerr('Query info not found for %s!', qname);
                            return r;
                        }

                        r.dataType = {
                            fields: qinfo
                        };
                    }

                    if (path[0] === 'q') {
                        var dbname = path[1],
                            qname = path[2]
                            qinfo = null
                        ;

                        if (queryInfo[dbname]) {
                            qinfo = queryInfo[dbname][qname];
                        }

                        if (!qinfo) {
                            cerr('Query info not found for %s!', qname);
                            return r;
                        }

                        r.dataType = {
                            fields: qinfo
                        };
                    }

                    return r;
                }
            );

            return result;
        },
        { }
    );

    res.send(routes);
}

function addRecord (req, res) {
    sendError(res, "NIY");
}

function getRecordList (req, res) {
    var dbname = req.params.db,
        relation = req.params.relation,
        page = req.query.page ? parseInt(req.query.page) : 1,
        count = req.query.perpage ? parseInt(req.query.perpage) : 20,
        sortby = req.query.sortby || 'id'
    ;

    if (!dbs[dbname]) {
        return sendError(res, 'Database not found.');
    }

    if (! examiner.isAlphaNumeric(dbname)) {
        return sendError(res, 'DB value must be alphanumeric.');
    }

    if (examiner.hasSQLcomment(dbname)) {
        return sendError(res, 'DB value can not contain SQL comments.');
    }

    if (! examiner.isAlphaNumeric(relation)) {
        return sendError(res, 'Relation value must be alphanumeric.');
    }

    if (examiner.hasSQLcomment(relation)) {
        return sendError(res, 'Relation value can not contain SQL comments.');
    }

    if (! examiner.isAlphaNumeric(sortby)) {
        return sendError(res, 'SortBy value must be alphanumeric.');
    }

    if (examiner.hasSQLcomment(sortby)) {
        return sendError(res, 'SortBy value can not contain SQL comments.');
    }

    if (isNaN(page)) {
        return sendError(res, 'Page value must be numeric.');
    }

    if (isNaN(count)) {
        return sendError(res, 'PerPage value must be numeric.');
    }

    var limit = (count < 1)    ? 1
              : (count > 1000) ? 1000
              : count
    ;
     
    var offset = limit * (page - 1);

    var query = util.format('select * from %s order by %s limit %d offset %d', relation, sortby, limit, offset);

    dbs[dbname].fetchAll(
        query,
        null,
        function (err, results) {
            if (err) { return sendError(res, err); }
            itsGood(res, { results: results });
        }
    );
}

function getRecord (req, res) {
    var dbname = req.params.db,
        relation = req.params.relation,
        id = req.params.id
    ;

    if (!dbs[dbname]) {
        return sendError(res, 'Database not found.');
    }

    if (! examiner.isAlphaNumeric(dbname)) {
        return sendError(res, 'DB value must be alphanumeric.');
    }

    if (examiner.hasSQLcomment(dbname)) {
        return sendError(res, 'DB value can not contain SQL comments.');
    }

    if (! examiner.isAlphaNumeric(relation)) {
        return sendError(res, 'Relation value must be alphanumeric.');
    }

    if (examiner.hasSQLcomment(relation)) {
        return sendError(res, 'Relation value can not contain SQL comments.');
    }

    if (! examiner.isAlphaNumeric(id)) {
        return sendError(res, 'ID must be a alphanumeric.');
    }

    var query = util.format('select * from %s where id = ?', relation);

    dbs[dbname].fetchRow(
        query,
        [ id ],
        function (err, row) {
            if (err) { return sendError(res, err); }
            itsGood(res, { row: row });
        }
    );
}

function getSubRecordList (req, res) {
    var dbname = req.params.db,
        relation = req.params.relation,
        id = req.params.id,
        subrel = req.params.subrelation
    ;

    if (!dbs[dbname]) {
        return sendError(res, 'Database not found.');
    }

    if (! examiner.isAlphaNumeric(dbname)) {
        return sendError(res, 'DB value must be alphanumeric.');
    }

    if (examiner.hasSQLcomment(dbname)) {
        return sendError(res, 'DB value can not contain SQL comments.');
    }

    if (! examiner.isAlphaNumeric(relation)) {
        return sendError(res, 'Relation value must be alphanumeric.');
    }

    if (examiner.hasSQLcomment(relation)) {
        return sendError(res, 'Relation value can not contain SQL comments.');
    }

    if (! examiner.isAlphaNumeric(subrel)) {
        return sendError(res, 'SubRelation value must be alphanumeric.');
    }

    if (examiner.hasSQLcomment(subrel)) {
        return sendError(res, 'SubRelation value can not contain SQL comments.');
    }

    if (! examiner.isAlphaNumeric(id)) {
        return sendError(res, 'ID must be a alphanumeric.');
    }

    var query = util.format('select * from %s where %s_id = ?', subrel, relation);

    dbs[dbname].fetchAll(
        query,
        [ id ],
        function (err, results) {
            if (err) { return sendError(res, err); }
            itsGood(res, { results: results });
        }
    );
}

function updateRecord (req, res) {
    sendError(res, "NIY");
}

function deleteRecord(req, res) {
    sendError(res, "NIY");
}

function authenticate (req, res) {
    var b = req.body,
        token = b.token,
        service = b.service,
        auth = b.auth
    ;

    if (!token) {
        token = uuid.v4();
    }

    if (service) {
        if (!plugins[service]) {
            return sendError(res, fmt("Service \"%s\" not found.", service));
        }

        if (!auth) {
            return sendError(res, fmt("Service auth info for \"%s\" not sent.", service));
        }

        return plugins[service].auth(
            auth,
            function (rval) {
                if (rval.ok) {
                    // it's good!

                    var s = sessions[token];

                    if (!s) {
                        s = session.create(token);
                        sessions[token] = s;
                    }

                    s.put(service, rval.info);

                    return res.send({ ok: true, token: token });
                }

                res.send(rval); // pass error along
            }
        );
    }

    res.send({ ok: true, token: token });
}

