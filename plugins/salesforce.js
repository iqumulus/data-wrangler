
module.exports = {
    auth: auth,
    routes: routes
};

function auth () {

}

function routes () {
    return [
        { method: 'get', path: '/query', proc: sfQuery }
    ];
}


function sfQuery () {

}
