
var
    clog = console.log,
    cerr = console.error,
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

function routes () {
    return [
        { method: 'get', path: '/query', proc: sfQuery }
    ];
}

function sfQuery (req, res) {
clog('SFQUERY');
    var info = req.iq.get('salesforce');

    if (!info) {
        return res.send({ ok: false, error: "Query: SalesForce auth info not found." });
    }

    if (!info.conn) {
        return res.send({ ok: false, error: "Query: No SalesForce connection?!" });
    }

clog("QUERY: %s", req.param('q'));

    var
        conn = info.conn,
        p = conn.query(req.param('q'))
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
}



