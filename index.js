/******************************************************************************

Yggdrasil - the IQ app platform REST interface to databases

Original Author: turtlekitty

Copyright (C) 2013 IQumulus LLC 

This following code is, unless otherwise specified, the sole property of
IQumulus LLC. It may not be used, reproduced or modified in any way 
without the explicit permission of IQumulus through a licensing agreement.

CONFIDENTIAL

******************************************************************************/

var
    config = require('./config.json'),
    fs = require('fs'),
    http = require('http'),
    https = require('https'),
    util = require('util'),
    express = require('express'),
    server = express(),
    moment = require('moment'),
    nodeDBI = require('node-dbi'),
    dbs = { },
    clog = console.log,
    cerr = console.error,
    fmt = util.format,
    alphaNumericRegex = /^\w+$/,
    uuidRegex = /^[A-Fa-f0-9]{8}-?[A-Fa-f0-9]{4}-?[A-Fa-f0-9]{4}-?[A-Fa-f0-9]{4}-?[A-Fa-f0-9]{12}$/
;

server.use(express.bodyParser());
server.use(express.cookieParser());
server.use(express.logger());

server.on('error', function (err) {
    console.error(err.message);
});

server.post('/db/:db/rel/:relation', addRecord);

server.get('/db/:db/rel/:relation', getRecordList);
server.get('/db/:db/rel/:relation/:id', getRecord);
server.get('/db/:db/rel/:relation/:id/:subrelation', getSubRecordList);

server.post('/db/:db/rel/:relation/:id', updateRecord);
server.del('/db/:db/rel/:relation/:id', deleteRecord);

config.databases.forEach(
    function (db) {
        dbs[db.name] = DBconnect(db);

        db.queries.forEach(
            function (q) {
                server.get(
                    fmt('/db/%s/query/%s', db.name, q.name),
                    function (req, res) {
                        query(); // fixme
                    }
                );
            }
        );
    }
);

console.log(
    "\nREST DB online.\n%s\n\n",
    moment().format('MMMM Do YYYY, h:mm:ss a')
);

http.createServer(server).listen(config.port);


// utils

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
        function (err, results) {
            if (err) { return itSucks(res, err); } // fixme
            itsGood(res, { results: results }); // fixme
        }
    );
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


// routes

function addRecord (req, res) {
    itsSucks(res, "NIY");
}

function getRecordList (req, res) {
    var relation = req.params.relation,
        page = req.query.page || 1,
        count = req.query.perpage || 20,
        sortby = req.query.sortby || 'id'
    ;

    if (! isAlphaNumeric(relation)) {
        return itSucks(res, 'Relation value must be alphanumeric.');
    }

    if (! isAlphaNumeric(sortby)) {
        return itSucks(res, 'SortBy value must be alphanumeric.');
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

    db.fetchAll(
        query,
        null,
        function (err, results) {
            if (err) { return itSucks(res, err); }
            itsGood(res, { results: results });
        }
    );
}

function getRecord (req, res) {
    var relation = req.params.relation,
        id = req.params.id
    ;

    if (! isAlphaNumeric(relation)) {
        return itSucks(res, 'Relation value must be alphanumeric.');
    }

    if (! isUUID(id)) {
        return itSucks(res, 'ID must be a UUID.');
    }

    var query = util.format('select * from %s where id = ?', relation);

    db.fetchRow(
        query,
        [ id ],
        function (err, row) {
            if (err) { return itSucks(res, err); }
            itsGood(res, { row: row });
        }
    );
}

function getSubRecordList (req, res) {
    var relation = req.params.relation,
        id = req.params.id,
        subrel = req.params.subrelation
    ;

    if (! isAlphaNumeric(relation)) {
        return itSucks(res, 'Relation value must be alphanumeric.');
    }

    if (! isUUID(id)) {
        return itSucks(res, 'ID must be a UUID.');
    }

    if (! isAlphaNumeric(subrel)) {
        return itSucks(res, 'SubRelation value must be alphanumeric.');
    }

    var query = util.format('select * from %s where %s_id = ?', subrel, relation);

    db.fetchAll(
        query,
        [ id ],
        function (err, results) {
            if (err) { return itSucks(res, err); }
            itsGood(res, { results: results });
        }
    );
}

function updateRecord (req, res) {
    itsSucks(res, "NIY");
}

function deleteRecord( req, res) {
    itsSucks(res, "NIY");
}


