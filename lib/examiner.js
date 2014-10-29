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
    util = require('util'),
    hb = require('handlebars'),
    clog = console.log,
    cerr = console.error,
    fmt = util.format,
    whitespaceRegex = /\s+/,
    alphaNumericRegex = /^[\sA-Za-z0-9_\-.]+$/,
    uuidRegex = /^[A-Fa-f0-9]{8}-?[A-Fa-f0-9]{4}-?[A-Fa-f0-9]{4}-?[A-Fa-f0-9]{4}-?[A-Fa-f0-9]{12}$/,
    sqlCommentRegex = /--+/g,
    queryVarRegex = /\$(\w+)/g,
    selectRegex = /^\s*select\s+(.+)\s+from.*$/i
;


module.exports = {
    ifNull: ifNull,
    numQuestions: numQuestions,
    examineQuery: examineQuery,
    validateQueryVars: validateQueryVars,
    findQvars: findQvars,
    tmplify: tmplify
};


function ifNull (x, defaultVal) {
    if (x === null || x === undefined) {
        return defaultVal;
    }

    return x;
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

function examineQuery (query) {
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

function findQvars (qtmpl) {
    return ifNull(qtmpl.match(queryVarRegex), []).map(strip$);
}

function strip$ (x) {
    return x.replace('$', '');
}

function tmplify (qtmpl) {
    return hb.compile( qtmpl.replace(queryVarRegex, '{{ $1 }}') );
}


