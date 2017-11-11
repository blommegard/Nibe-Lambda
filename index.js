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
        
        request.post({url:'https://api.nibeuplink.com/oauth/token', formData: formData}, function(err, resp, body) {
            if (err) {
                callback(null, resp);
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
    var requestsCompleted = 0
    var allProperties = {}
    
    function dataCallback(object) {
        requestsCompleted++
        
        if (object !== null) {
            allProperties = Object.assign(allProperties, object);
        }
        
        if (requestsCompleted == 5) {
            allPropertiesBody = JSON.stringify(allProperties)
            
            var response = {
                statusCode: 200,
                body: allPropertiesBody
            };

            var params = {
                topic: 'Nibe/all',
                payload: allPropertiesBody,
                qos: 0
            };
            iot.publish(params, function(err, data) {
                if (err) console.log(err, err.stack); // an error occurred
                else console.log(data);           // successful response
            });

            callback(null, response);
        }
    }
    
    getNibeData(accessToken, "STATUS", [
        {name: "outdoor_temp", parameterId: 40004},
        {name: "hot_water_top_temp", parameterId: 40013},
        {name: "hot_water_charging_temp", parameterId: 40014},
        {name: "degree_minutes", parameterId: 43005},
        {name: "current", parameterId: 40083},
        {name: "current", parameterId: 40081},
        {name: "current", parameterId: 40079},
        ], dataCallback)
    getNibeData(accessToken, "CPR_INFO_EP14", [
        {name: "compressor_operating_time", parameterId: 43420},
        {name: "compressor_operating_time_hot_water", parameterId: 43424},
        {name: "compressor_starts", parameterId: 43416},
        {name: "compressor_freq", parameterId: 43136},
        {name: "brine_pump_speed_percent", parameterId: 43439},
        {name: "heating_medium_pump_speed_percent", parameterId: 43437},
        {name: "brine_in_temp", parameterId: 40015},
        {name: "brine_out_temp", parameterId: 40016},
        {name: "condenser_out_temp", parameterId: 40017},
        {name: "hot_gas_temp", parameterId: 40018},
        {name: "liquid_line_temp", parameterId: 40019},
        {name: "suction_gas_temp", parameterId: 40022},
        ], dataCallback)
    getNibeData(accessToken, "SYSTEM_1", [
        {name: "heating_medium_calculated_flow_temp", parameterId: 43009},
        {name: "heating_medium_flow_temp", parameterId: 40008},
        {name: "heating_medium_return_temp", parameterId: 40012},
        //{name: "room_temperature", parameterId: 40033},
        ], dataCallback)
    getNibeData(accessToken, "SMART_PRICE_ADAPTION", [
        {name: "price_of_electricity", parameterId: 10069},
        ], dataCallback)
    getNibeData(accessToken, "ADDITION", [
        {name: "addition_blocked", parameterId: 10033},
        {name: "addition_time", parameterId: 43081},
        ], dataCallback)
}

function getNibeData(accessToken, category, parameters, callback) {
        request.get("https://api.nibeuplink.com/api/v1/systems/"+process.env.system+"/serviceinfo/categories/"+category, function(err, resp, body) {
        if (err) {
            callback(null);
            return
        }
        
        let test = parseBody(body, parameters)
        
        callback(test)

    }).auth(null, null, true, accessToken);
}

function parseBody(body, parameters) {
    let array = JSON.parse(body)
    var gather = {}
    
    for (var i = 0, len = array.length; i < len; i++) {
        let object = array[i]
        
        for (var j = 0, jlen = parameters.length; j < jlen; j++) {
            let parameter = parameters[j]
        
            if (parameter.parameterId == object.parameterId) {
                var name = parameter.name
                if (object.designation.length > 0) {
                    name = parameter.name+"-"+object.designation
                }
                gather[name] = object.rawValue
            }
        }
    }
    
    return gather
}

exports.handler = (event, context, callback) => {
    console.log("request: " + JSON.stringify(event));
    
    if (event.resource == "/NibeUplink/auth") {
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
        
        request.post({url:'https://api.nibeuplink.com/oauth/token', formData: formData}, function(err, resp, body) {
            if (err) {
                callback(null, resp);
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
    } else {
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
    }
};

