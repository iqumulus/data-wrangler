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
    express = require('express'),
    server = express(),
    hb = require('handlebars'),
    moment = require('moment'),
    nodeDBI = require('node-dbi'),
    dbs = { },
    templates = { },
    queryinfo = { },
    clog = console.log,
    cerr = console.error,
    fmt = util.format,
    sqlhttpMap = {
        select: 'get',
        insert: 'put',
        update: 'post',
        delete: 'del'
    },
    whitespaceRegex = /\s+/,
    alphaNumericRegex = /^[\sA-Za-z0-9_\-.]+$/,
    uuidRegex = /^[A-Fa-f0-9]{8}-?[A-Fa-f0-9]{4}-?[A-Fa-f0-9]{4}-?[A-Fa-f0-9]{4}-?[A-Fa-f0-9]{12}$/,
    sqlCommentRegex = /--+/g,
    queryVarRegex = /\$(\w+)/g,
    subQueryRegex = /\(\s*select.*?\)/gi,
    selectRegex = /^\s*select\s+(.+)\s+from.*$/i
;

server.use(gateKeeper());
server.use(express.bodyParser());
server.use(express.cookieParser());
server.use(express.logger());

server.on('error', function (err) {
    console.error(err.message);
});

server.get('/', showAPI);

/*
server.post('/db/:db/rel/:relation', addRecord);

server.get('/db/:db/rel/:relation', getRecordList);
server.get('/db/:db/rel/:relation/:id', getRecord);
server.get('/db/:db/rel/:relation/:id/:subrelation', getSubRecordList);

server.post('/db/:db/rel/:relation/:id', updateRecord);
server.del('/db/:db/rel/:relation/:id', deleteRecord);
*/

config.databases.forEach(
    function (db) {
        dbs[db.name] = DBconnect(db);

        Object.keys(db.queries).forEach(
            function (qname) {
                queryinfo[qname] = examineQuery(db.queries[qname]);
                makeQueryRoute(db.name, qname, db.queries[qname]);
            }
        );
    }
);

console.log(
    "\nREST DB online.\n%s\n",
    moment().format('MMMM Do YYYY, h:mm:ss a')
);

http.createServer(server).listen(config.port);


// utils

function gateKeeper () { 
    return function (req, res, next) {
        req.iqumulus = { }; 

        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');

        if ('OPTIONS' === req.method) {
          return res.send(200);
        }    

        return next();

        // current unused authentication stuff

        var token = req.cookies.portal_auth || common.getp(req, 'token');

        isLoggedIn(
            token,
            function (session) {

                if (session) {
                    req.iqumulus.session = session;
                }    

                if (isUnrestricted(req)) {
                    return next();
                }    

                if (!session) {
                    console.log('GateKeeper denied access');
                    return sendHome(res, 'Access Denied');
                }    

                return next();
            }    
        );   
    };   
}    

function ifNull (x, defaultVal) {
    if (x === null || x === undefined) {
        return defaultVal;
    }

    return x;
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

function numQuestions (query) {
    return ifNull(query.match(/\?/g), []).length;
}

function isAlphaNumeric (x) {
    return alphaNumericRegex.test(x);
}

function isUUID (x) {
    return uuidRegex.test(x);
}

function itsGood (res, rvals) {
    var sendMe = rvals || { };
    sendMe.ok = true;
    res.send(sendMe);
}

function itSucks (res, error) {
    res.send({ ok: false, error: error });
}

function parseColspec (text) {
    var chars = text.split('')
        holder = [ ],
        cols = [ ]
    ;

    function parseFunk (chars) {
        var holder = [ ];

        while (chars.length > 0) {
            var c = chars.shift();

            if (c === '(') {
                holder.push(c, parseFunk( chars ) );
            }
            else if (c === ')') {
                holder.push(c);
                return holder.join('');
            }
            else {
                holder.push(c);
            }
        }

        console.error('Unmatched "("!');

        return holder.join('');
    }

    function mutate () {
        cols.push( holder.join('').trim() );
    }

    while (chars.length > 0) {
        var c = chars.shift();

        if (c === ',') {
            mutate();
            holder = [ ];
        }
        else {
            if (c === '(') {
                holder.push(c, parseFunk( chars ) );
            }
            else {
                holder.push(c);
            }
        }
    }

    if (holder.length > 0) {
        mutate();
    }

    return cols;
}

function examineQuery(query) {
    var fields = [];

    if (selectRegex.test(query)) {
        var colspec = selectRegex.exec(query)[1],
            things = parseColspec(colspec)
        ;

        things.forEach(
            function (thing) {
                var newf = whitespaceRegex.test(thing)
                         ? thing.split(whitespaceRegex).pop()
                         : thing.split('.').pop()
                ;

                fields.push(newf);
            }
        );
    }

    return fields;
}

function validateQueryVars (req, qvars) {
    var
        qvals = { },
        fail = []
    ;

    qvars.forEach(
        function (qv) {
            var val = req.param(qv);

            if (!val) {
                fail.push( fmt('Parameter "%s" is required!\n', qv) );
                return;
            }

            if (sqlCommentRegex.test(val)) {
                fail.push('SQL comments are forbidden as inputs.');
                return;
            }

            if (! (isUUID(val) || isAlphaNumeric(val)) ) {
                fail.push('Query parameters must be alphanumeric.');
                return;
            }

            qvals[qv] = val;
        }
    );

    if (fail.length > 0) {
        return { ok: false, error: fail.join('\n') };
    }

    return { ok: true, results: qvals };
}

function makeQueryRoute (dbname, qname, qtmpl) {
    var
        numParams = numQuestions(qtmpl),
        strip$ = function (x) { return x.replace('$', ''); }, 
        qvars = ifNull(qtmpl.match(queryVarRegex), []).map(strip$),
        qyarr = [ ]
    ;

    templates[qname] = hb.compile( qtmpl.replace(queryVarRegex, '{{ $1 }}') );

    for (var i = 1; i <= numParams; i++) {
        qyarr[i] = '/:p' + i;
    }

    var routePath = [ fmt('/query/%s', qname) ].concat(qyarr).join('');

    server.get(
        routePath,
        function (req, res) {
            var args = [ ],
                qvals = { },
                fail = ''
            ;

            var checkIt = validateQueryVars(req, qvars);

            if (checkIt.ok) {
                qvals = checkIt.results;
            }
            else {
                return itSucks(res, checkIt.error);
            }

            for (var i = 1; i <= numParams; i++) {
                var val = req.param( 'p' + i );

                if (!val) {
                    return itSucks(res, fmt('Missing parameter: %s', 'p' + i));
                }

                args.push(val);
            }

            var qtext = (qvars.length > 0)
                      ? templates[qname](qvals)
                      : qtmpl
            ;

            query(
                dbs[dbname],
                qtext,
                args,
                function (e, results) {
                    if (e) {
                        return itSucks(res, e);
                    }

                    itsGood(res, { results: results });
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

                    if (path[0] !== 'query') {
                        return r;
                    }

                    var qname = path[1],
                        qinfo = queryinfo[qname]
                    ;

                    if (!qinfo) {
                        cerr('Query info not found for %s!', qname);
                        return r;
                    }

                    r.dataType = {
                        fields: qinfo
                    };

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
    itSucks(res, "NIY");
}

function getRecordList (req, res) {
    var dbname = req.params.db,
        relation = req.params.relation,
        page = req.query.page ? parseInt(req.query.page) : 1,
        count = req.query.perpage ? parseInt(req.query.perpage) : 20,
        sortby = req.query.sortby || 'id'
    ;

    if (!dbs[dbname]) {
        return itSucks(res, 'Database not found.');
    }

    if (! isAlphaNumeric(dbname)) {
        return itSucks(res, 'DB value must be alphanumeric.');
    }

    if (sqlCommentRegex.test(dbname)) {
        return itSucks(res, 'DB value can not contain SQL comments.');
    }

    if (! isAlphaNumeric(relation)) {
        return itSucks(res, 'Relation value must be alphanumeric.');
    }

    if (sqlCommentRegex.test(relation)) {
        return itSucks(res, 'Relation value can not contain SQL comments.');
    }

    if (! isAlphaNumeric(sortby)) {
        return itSucks(res, 'SortBy value must be alphanumeric.');
    }

    if (sqlCommentRegex.test(sortby)) {
        return itSucks(res, 'SortBy value can not contain SQL comments.');
    }

    if (isNaN(page)) {
        return itSucks(res, 'Page value must be numeric.');
    }

    if (isNaN(count)) {
        return itSucks(res, 'PerPage value must be numeric.');
    }

    var limit = (count < 1)    ? 1
              : (count > 1000) ? 1000
              : count
    ;
     
    var offset = limit * (page - 1);

    var query = util.format('select * from %s order by %s offset %d limit %d', relation, sortby, offset, limit);

    dbs[dbname].fetchAll(
        query,
        null,
        function (err, results) {
            if (err) { return itSucks(res, err); }
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
        return itSucks(res, 'Database not found.');
    }

    if (! isAlphaNumeric(dbname)) {
        return itSucks(res, 'DB value must be alphanumeric.');
    }

    if (sqlCommentRegex.test(dbname)) {
        return itSucks(res, 'DB value can not contain SQL comments.');
    }

    if (! isAlphaNumeric(relation)) {
        return itSucks(res, 'Relation value must be alphanumeric.');
    }

    if (sqlCommentRegex.test(relation)) {
        return itSucks(res, 'Relation value can not contain SQL comments.');
    }

    if (! isAlphaNumeric(id)) {
        return itSucks(res, 'ID must be a alphanumeric.');
    }

    var query = util.format('select * from %s where id = ?', relation);

    dbs[dbname].fetchRow(
        query,
        [ id ],
        function (err, row) {
            if (err) { return itSucks(res, err); }
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
        return itSucks(res, 'Database not found.');
    }

    if (! isAlphaNumeric(dbname)) {
        return itSucks(res, 'DB value must be alphanumeric.');
    }

    if (sqlCommentRegex.test(dbname)) {
        return itSucks(res, 'DB value can not contain SQL comments.');
    }

    if (! isAlphaNumeric(relation)) {
        return itSucks(res, 'Relation value must be alphanumeric.');
    }

    if (sqlCommentRegex.test(relation)) {
        return itSucks(res, 'Relation value can not contain SQL comments.');
    }

    if (! isAlphaNumeric(subrel)) {
        return itSucks(res, 'SubRelation value must be alphanumeric.');
    }

    if (sqlCommentRegex.test(subrel)) {
        return itSucks(res, 'SubRelation value can not contain SQL comments.');
    }

    if (! isAlphaNumeric(id)) {
        return itSucks(res, 'ID must be a alphanumeric.');
    }

    var query = util.format('select * from %s where %s_id = ?', subrel, relation);

    dbs[dbname].fetchAll(
        query,
        [ id ],
        function (err, results) {
            if (err) { return itSucks(res, err); }
            itsGood(res, { results: results });
        }
    );
}

function updateRecord (req, res) {
    itSucks(res, "NIY");
}

function deleteRecord( req, res) {
    itSucks(res, "NIY");
}


