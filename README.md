# IQ Data Wrangler

### Install


Step 1: Install node.js on the server where this wrangler will live.

    http://nodejs.org/


Step 2: Install forever

    npm install -g forever


Step 3: Get the wrangler source

On the server, execute the command

    git clone 'https://github.com/iqumulus/data-wrangler.git'

in the directory where you want it to live.


Step 4: Install dependencies

cd to the wrangler directory and execute

    npm install


Step 5: Install the init script

    cp data-wrangler/iqdatawrangler.init.d /etc/init.d/iqdatawrangler
    chkconfig --add iqdatawrangler


Step 6: Place desired configuration into data-wrangler/config.json

The config file looks like this:

    {
        "host": "0.0.0.0",
        "port": 443,
        "ssl": {
            "enabled": true,
            "ca": "example.crt",
            "key": "example.key",
            "cert": "example.crt"
        },
        "databases": [
            {
                "name": "zang",
                "type": "pg",
                "host": "localhost",
                "database": "playground",
                "user": "turtlekitty",
                "password": "wakkawakkawakka",
                "queries": {
                    "getZang": "select * from zang where id = ?",
                    "getZangPowers": "select z.name as zang, p.name, p.type, p.rank from zang z inner join power p on (z.id = p.brawler_id) where z.id = ?",
                }
            },
            {
                "name": "foo",
                "type": "mysql",
                "host": "localhost",
                "database": "foobarbaz",
                "user": "turtlekitty",
                "password": "wakkawakkawakka",
                "queries": {
                    "descTable": "desc $table",
                    "getFoo": "select * from foo where id = ?",
                    "getFooBars": "select bar.id, bar.rank from foo inner join bar on (foo.id = bar.foo_id) where foo.id = ?",
                    "getStuff": "select * from $relation where $field = ?"
                }
            }
        ]
    }

The toplevel "host", "port", and "ssl" keys tell the wrangler where to listen and whether to use SSL.

Each entry in the array of databases requires these fields:

* name (used internally - must be unique)
* type (pg or mysql)
* host (DNS name or IP address)
* database (the actual name used in the RDBMS)
* user (database username to use)
* password
* queries

The "queries" object requires the most attention.  It is explained below.


Step 7: Fire it up!

    service iqdatawrangler start


### Query Configuration


The queries object contains a set of query identifiers pointing to SQL statements.
Query identifiers/names must be unique across all databases.
Placing a query in this object creates a route on the wrangler's API.  For example:

    "queries": {
        "fooMakers": "select id, name from fooMakers"
    }

Would create a route like

    http://<dw host>/query/fooMakers

which would return an array of objects with "id" and "name" fields.

Queries can contain variables.  There are two kinds: positional variables and name parameters.

Positional variables are identified by a question mark. They may only appear in places where a value is permitted in SQL. So,

    "select * from fooMakers where id = ?"

is valid, but

    "select * from ? where id = 1"

is not.

Each "?" added to a query adds to the query's route.  The following config

    "queries": {
        "fooMakers": "select id, name from fooMakers",
        "fooMakersByPlace": "select id, name from fooMakers where place = ?",
        "fooMakersByPlaceAndType": "select id, name from fooMakers where place = ? and type = ?"
    }

would lead to three routes:

    /query/fooMakers
    /query/fooMakers/:place
    /query/fooMakers/:place/:type

Accessed like

    /query/fooMakers
    /query/fooMakers/Texas
    /query/fooMakers/Texas/green

Positional variables are automatically quoted.

Named parameters are identified by a dollar sign followed by an alphanumeric name, like "$foo" or "$bar45".
They are passed as query string parameters.

The placement of named parameters is more flexible than positional vars.  One can write

    "fooGeneric": "select $column from $table where $field = '$value'"

and have the following query:

    /query/fooGeneric?column=name&table=fooMakers&field=place&value=Texas

work as expected.  The drawback to this flexibility is that the values passed to named parameters must be alphanumeric (aside from "_" and single "-" characters).
All named parameters defined in the query become required to execute the query.

One can mix positional variables and named parameters:

    "getStuff": "select * from $relation where $field = ?"

    ->

    /query/getStuff/4?relation=foo&field=id

