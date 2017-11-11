var aws = require('aws-sdk');
var s3 = new aws.S3();
var iot = new aws.IotData({endpoint: process.env.iot});
var request = require('request');

function redirectToAuth(callback) {
        var response = {
            statusCode: 302,
            headers: {
                Location: "https://api.nibeuplink.com/oauth/authorize?response_type=code&client_id="+process.env.identifier+"&scope="+process.env.scope+"&redirect_uri="+process.env.redirect+"&state=l33t"
            }
        };
        callback(null, response);
}

function writeTokens(accessToken, refreshToken) {
    var buf = new Buffer.from(JSON.stringify({"access":accessToken, "refresh":refreshToken}));

    var params = {
        Body: buf,
        Bucket: "nibe-uplink-tokens", 
        Key: "tokens.json", 
    }
 
    s3.putObject(params, function(err, data) {
        if (err) {
            console.log(err, err.stack);
        } else {
            console.log(data);
        }
    });
}

function refreshToken(refreshToken, callback) {
        var formData = {
            grant_type: "refresh_token",
            client_id: process.env.identifier,
            client_secret: process.env.secret,
            refresh_token: refreshToken,
        };
        
        request.post({url:'https://api.nibeuplink.com/oauth/token', formData: formData}, function optionalCallback(err, httpResponse, body) {
            if (err) {
                callback(null, httpResponse);
                return
            }
            let jsonBody = JSON.parse(body)
            let accessToken = jsonBody.access_token
            let refreshToken = jsonBody.refresh_token
            
            writeTokens(accessToken, refreshToken)
            
            getData(accessToken, callback)
        });
}

function getData(accessToken, callback) {
    request.get("https://api.nibeuplink.com/api/v1/systems/"+process.env.system+"/serviceinfo/categories/STATUS", function optionalCallback(err, httpResponse, body) {
        if (err) {
            callback(null, httpResponse);
            return
        }
        var response = {
            statusCode: 200,
            body: body
        };

        var params = {
            topic: 'test/test',
            payload: body,
            qos: 0
        };
        iot.publish(params, function(err, data) {
            if (err) console.log(err, err.stack); // an error occurred
            else console.log(data);           // successful response
        });

        callback(null, response);
    }).auth(null, null, true, accessToken);
}

exports.handler = (event, context, callback) => {
    console.log("request: " + JSON.stringify(event));
    
    if (event.resource == "/NibeUplink") {
        s3.getObject({
            Bucket: "nibe-uplink-tokens",
            Key: "tokens.json"
        }, function(err, data) {
            if (err) {
                console.log(err, err.stack);
                redirectToAuth(callback)
            } else {
                console.log("Tokens:\n" + data.Body.toString());            
                var tokens = JSON.parse(data.Body.toString());
                refreshToken(tokens.refresh, callback)
            }
        });
    } else if (event.resource == "/NibeUplink/auth") {
        redirectToAuth(callback)
    } else if (event.resource == "/NibeUplink/callback") {
        let code = event.queryStringParameters.code
        
        var formData = {
            grant_type: "authorization_code",
            client_id: process.env.identifier,
            client_secret: process.env.secret,
            code: code,
            redirect_uri: process.env.redirect,
            scope: process.env.scope
        };
        
        request.post({url:'https://api.nibeuplink.com/oauth/token', formData: formData}, function optionalCallback(err, httpResponse, body) {
            if (err) {
                callback(null, httpResponse);
                return
            }
            let jsonBody = JSON.parse(body)
            let accessToken = jsonBody.access_token
            let refreshToken = jsonBody.refresh_token
            
            writeTokens(accessToken, refreshToken)
            
            var response = {
                statusCode: 200
            };
            callback(null, response);
        });
    }
};

