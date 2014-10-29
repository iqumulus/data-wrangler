
var
    util = require('util'),
    fmt = util.format,
    clog = console.log,
    cerr = console.error,
    examiner = require('../lib/examiner'),
    jsforce = require('jsforce')
;

module.exports = {
    auth: auth,
    routes: routes
};

function auth (info, fn) {
    var sfconn = new jsforce.Connection({});

    sfconn.login(
        info.username,
        info.password,
        function(err, uinfo) {
clog("UINFO (1): %j", uinfo);
            if (err) {
                cerr('Salesforce auth error (1): %j', err);

                sfconn.login(
                    info.username,
                    info.password + info.securityToken,
                    function (e, uinfo) {
clog("UINFO (2): %j", uinfo);
                        if (e) {
                            cerr('Salesforce auth error (2): %j', e);
                            return fn({ ok: false, error: e });
                        }

                        info.conn = sfconn;

                        fn({ ok: true, info: info });
                    }
                );

                return;
            }

            info.conn = sfconn;

            fn({ ok: true, info: info });
        }
    );
}

function routes (conf) {
    var fields = [ ];

    if (!conf.queries) {
        return [];
    }

    return Object.keys(conf.queries).map(
        function (qname) {
            var qtmpl = conf.queries[qname],
                fields = examiner.examineQuery(qtmpl),
                qvars = examiner.findQvars(qtmpl),
                rpath = fmt('/query/%s', qname),
                template = examiner.tmplify(qtmpl),
                rproc = sfQueryRoute(template, qvars)
            ;

            return { method: 'get', path: rpath, proc: rproc, fields: fields }
        }
    );
}

function sfQueryRoute (template, qvars) {
    return function (req, res) {
clog('SFQUERY');
        var info = req.iq.get('salesforce'), // req.iq holds the session
            args = [ ],
            qvals = { }
        ;

        if (!info) {
            return res.send({ ok: false, error: "Query: SalesForce auth info not found." });
        }

        if (!info.conn) {
            return res.send({ ok: false, error: "Query: No SalesForce connection?!" });
        }

        var checkIt = examiner.validateQueryVars(req, qvars);

        if (checkIt.ok) {
            qvals = checkIt.results;
        }
        else {
            return res.send({ ok: false, error: checkIt.error });
        }

        var qtext = template(qvals),
            conn = info.conn,
            p = conn.query(qtext)
        ;

        // promises, promises...

        p.then(
            function(result) {
                res.send({ ok: true, result: result});
            },
            function (e) {
                cerr('Salesforce query error: %j', e);
                res.send({ ok: false, error: e });
            }
        );
    };
}

