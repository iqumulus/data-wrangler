

module.exports.create = function (token) {
    var
        session = null,
        vars = { }
    ;

    function id () {
        return token;
    }

    function get (key) {
        return vars[key] || null;
    }

    function put (key, val) {
        vars[key] = val;
        return session;
    }

    function del (key) {
        delete vars[key];
        return session;
    }

    function has (key) {
        return vars[key] !== undefined;
    }

    function keys () {
        return Object.keys(vars);
    }

    session = {
        id: id,
        get: get,
        put: put,
        del: del,
        has: has,
        keys: keys
    };

    return session;
};

