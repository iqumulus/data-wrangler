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


Step 5: Install the init script (SysV-based linux installs - others will require adjustment)

    cp data-wrangler/iqdatawrangler.init.d /etc/init.d/iqdatawrangler
    chkconfig --add iqdatawrangler


Step 6: Place desired configuration into data-wrangler/config.json

The config file looks like this:

```json

{
    "host": "0.0.0.0",
    "port": 4400,
    "ssl": {
        "enabled": true,
        "ca": "/home/ssl/certificate_authority.crt",
        "key": "/home/ssl/myKey.key",
        "cert": "/home/ssl/myCert.crt"
    },
    "genericCRUD": true,
    "databases": [
        {
            "name": "billing",
            "type": "pg",
            "host": "billing.example.com",
            "database": "our_billing",
            "user": "fozzy",
            "password": "wakkawakkawakka",
            "queries": {
                "invoices": "select * from invoices where date = ?",
                "lineitems": "select * from line_items where invoice_id = ?",
                "anyById": "select * from $table where id = ?",
                "getXfromYwhereZisQ": "select $x from $y where $z = '$q'"
            }
        },
        {
            "name": "support",
            "type": "mysql",
            "host": "support.example.com",
            "database": "suppert_db",
            "user": "kermit",
            "password": "Hi, Ho! Kermit the Frog here!",
            "queries": {
                "descTable": "desc $table",
                "ticket": "select * from ticket where id = ?",
                "ticketAnswers": "select t.id, a.* from ticket t inner join answer a on (t.id = a.ticket_id) where t.id = ?",
                "getStuff": "select * from $relation where $field = ?"
            }
        }
    ],
    "externalServices": [
        {
            "name": "WorldBank",
            "baseURI": "http://api.worldbank.org/countries",
            "routes": [
                {
                    "method": "get",
                    "localpath": "/countrydata/$country/$fromYear/$toYear",
                    "path": "/{{ country }}/indicators/NY.GDP.PCAP.CD?format=json&date={{ fromYear }}:{{ toYear }}"
                }
            ]
        }
    ],
    "plugins": {
        "salesforce": {
            "queries": {
                "accounts": "select id, accountnumber, name from account",
                "fromwhat": "select id from $what"
            }
        }
    }
}


```

The toplevel "host", "port", and "ssl" keys tell the wrangler where to listen and whether to use SSL.
SSL is strongly recommended if the wrangler is to be exposed on a public interface.

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
    /query/fooMakersByPlace/:place
    /query/fooMakersByPlaceAndType/:place/:type

Accessed like

    /query/fooMakers
    /query/fooMakersByPlace/Texas
    /query/fooMakersByPlaceAndType/Texas/green

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


### Generic CRUD operations

If "genericCRUD" is set to true in the config file, a number of routes will be created:

GET "/db/:db/rel/:relation"

Get a list of rows from an arbitrary relation in the database identified by :db (this is the "name" field in the config file).
This route requires :db and :relation parameters to be defined in the path.
Optional query string parameters:
    page (page number)
    perpage (rows per page)
    sortby (column by which to order results)

Example: curl 'https://dev.iqumulus.com:4400/db/billing/rel/invoice?perpage=10&page=2&sortby=date'

```json
{
    ok: true,
    results: [
        { "id": 1, "date": "2014-10-01", "amount": "33.00" },
        ...
    ]
}
```


GET "/db/:db/rel/:relation/:id"

Gets a single record from the named :db and :relation.  The relation must have an "id" column.

Example: curl 'https://dev.iqumulus.com:4400/db/support/rel/ticket/42'

```json
{
    ok: true,
    row: {
        "id": 1,
        "date": "2014-10-02",
        "subject": "All the things are broken!",
        ...
    }
}
```

GET "/db/:db/rel/:relation/:id/:subrelation"

Gets a list of records tied to a parent record.  The subrelation must reference the parent with a column like "[parent-name]_id".

Example: curl 'https://dev.iqumulus.com:4400/db/billing/rel/invoice/42/linetems'

```json
{
    ok: true,
    results: [
        { "id": 101, "invoice_id": 42, "item_id": 37, "quantity": "99" },
        ...
    ]
}
```

The routes for generic row creation, modification, and deletion are not yet implemented.


### External REST APIs

External services can be piped through the wrangler.

Each service object (in the "externalServices" array in the config file) must have a name, a baseURI, and a list of routes, like so:

```json
{
    "name": "WorldBank",
    "baseURI": "http://api.worldbank.org/countries",
    "routes": [
        {
            "method": "get",
            "localpath": "/countrydata/$country/$fromYear/$toYear",
            "path": "/{{ country }}/indicators/NY.GDP.PCAP.CD?format=json&date={{ fromYear }}:{{ toYear }}"
        }
    ]
}
```

For each route:
    "method": should be an HTTP verb - get, post, put, delete, etc.
    "localpath": is the path exposed by the wrangler.  This can contain $-variables, which can be substituted into the...
    "path": The path to gather info from the external API.

Example: curl 'https://dev.iqumulus.com:4400/ffi/WorldBank/countrydata/US/2005/2006'

```json
[
    {"page":1,"pages":1,"per_page":"50","total":2},
    [
        {
            "indicator": {"id":"NY.GDP.PCAP.CD","value":"GDP per capita (current US$)"},
            "country": {"id":"US","value":"United States"},
            "value":"46443.81019859",
            "decimal":"0",
            "date":"2006"
        },
        {
            "indicator":{"id":"NY.GDP.PCAP.CD","value":"GDP per capita (current US$)"},
            "country":{"id":"US","value":"United States"},
            "value":"44313.5852412812",
            "decimal":"0",
            "date":"2005"
        }
    ]
]
```


### Plugins

The wrangler has a plugin system for future expansion.



