{
  "id" : "HEPop101",
  "socket": "udp", // udp, tcp, http, sipfix
  "port": 9060,
  "address": "127.0.0.1",
  "queue": {
    "timeout": 2000, //if there's no data input until timeout, emit data forcefully.
    "maxSize": 1000, //data emitted count
    "useInterval": true //if this value is true, data event is emitted even If new data is pushed.
  },
  "dbName": "hepic",
  "tableName": "hep",
  "db": {
	"rawSize": 8000,
  	"pgsql":{
  	  "host": "localhost",
  	  "port": 5432,
  	  "user": "homer_user",
  	  "password": "homer_password"
  	}
  },
  "metrics": {
	"influx":{
		"period": 30000,
		"expire": 300000, 
		"dbName": "hep",
		"hostname": "localhost:8086"
	}
  },
  "db_off": {
	"rethink" : {
	  "servers":[
	    {
		"host": "127.0.0.1",
		"port":28015
	    }
  	  ]
	},
  	"mongodb":{
	  "url": "mongodb://localhost:27017/homer"
	}
  },
  "debug": false
}
