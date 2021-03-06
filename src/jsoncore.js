const log = require('./logger');
const stringify = require('safe-stable-stringify');
const flatten = require('flat')
const config = require('./config').getConfig();
const sipdec = require('parsip');

var Receptacle = require('receptacle');
var db = new Receptacle({ max: 1024 });
const ttl = { ttl: 600000 };

const metrics = require('./metrics').metrics;
var mm = true;

if(!config.metrics || !config.metrics.influx){
	log('%data:red Metrics disabled');
	mm = false;
} else {
	log('%data:green Metrics enabled %s', stringify(config.metrics.influx));
}

var buckets = [];

const processJson = function(data,socket) {
	/* Plain Objects */
	try {
  	  //if (config.debug) log('%data:cyan JSON Net [%s:blue][%s:green]', stringify(socket) );
	  if (!data) return;
	  data = JSON.parse(data.toString());
  	  if (config.debug) log('%data:cyan JSON Data [%s:blue][%s:green]', stringify(data) );
	  // DB Schema
	  var insert = { "protocol_header": socket._peername || {},
			 "data_header": {},
			 "raw": data || ""
		};
	  var tags = {};
	  // Create protocol bucket
	  var key = 1000 + "_"+ (insert.protocol_header.type || "default");
	  if (config.db.pgsql && !buckets[key] ) { buckets[key] = require('./bucket').pgp_bucket; }
	  // else if (config.db.rethink &&!buckets[key]) { const r_bucket = require('./bucket').bucket; const r = require('./bucket').r; }
	  buckets[key].set_id("hep_proto_"+key);

	  if (data.type && data.event && data.session_id){
	    // Janus Events
	    if (config.debug) log('%data:green JANUS REPORT [%s]',stringify(data) );
	    /* Static SID from session_id */
	    insert.sid = data.session_id || '000000000000';
	    tags = { session: data.session_id, handle: data.handle_id };

	    if (data.event && data.event.opaque_id) {
		tags.opaque_id = data.event.opaque_id;
		insert.protocol_header.correlation_id = data.event.opaque_id;
	    }
	    if (data.type) tags.type = data.type;

	    /* Direction? */
		if (data.emitter) insert.protocol_header.srcIp = data.emitter || insert.protocol_header.address || "Janus";
	    	if (data.session_id) insert.protocol_header.dstIp = data.session_id;
	    	if (data.handle_id) insert.protocol_header.srcIp = data.handle_id;

	    switch(data.type) {

		case 1:
		  /* Transport Event */
		  if (data.event.name) insert.data_header.event = data.event.name;
		  if (data.event.transport && data.event.transport.id) {
			insert.data_header.event = data.event.name;
			insert.data_header.transport_id = data.event.transport.id;
			db.set(data.session_id, {transport: data.event.transport.id }, tll);
			var ip = db.get(data.event.transport.id);
			if (ip) {
				insert.protocol_header.dstIp = ip.ip;
				insert.protocol_header.dstPort = ip.port;
			}
		  }
		  break;

		case 2:
		  /* Handle Event */
		  if (data.event.transport && data.event.transport.id) {
			insert.data_header.event = data.event.name;
			// db.set(data.session_id, {transport: data.event.transport.id }, tll);
		  } else {
			insert.data_header.event = data.event.name;
			insert.data_header.dstIp = data.event.plugin;
		  }
		  break;

		case 8:
		  /* JSEP SDP TODO: extract SDP and map to Session participants */
			insert.data_header.event = "SDP " + (data.event.owner || "");
			if (data.event.jsep){
			   insert.data_header.event += " "+ data.event.jsep.type;
			   try {
				var sdp = sipdec.getSDP(data.event.jsep.sdp);
				db.set("sdp_"+data.handle_id,sdp);
				insert.data_header.room = sdp.name || "";
				if (data.event.jsep.type == 'offer'){
					insert.protocol_header.srcIp = sdp.origin.address;
					insert.protocol_header.srcPort = sdp.media[0].port || 0;
				} else if (data.event.jsep.type == 'answer') {
					insert.protocol_header.dstIp = sdp.media[0].connection.ip || sdp.origin.address;
					insert.protocol_header.dstPort = sdp.media[0].port || 0;
				}
			   } catch(e) { log(e); }
			}
		  break;

		case 16:
		  /* PeerConnection Event */
		  if (data.event.connection) {
			insert.data_header.event = data.event.connection;
			insert.data_header.reason = data.event.reason;
		  } else if (data.event.ice) {
			insert.data_header.event = data.event.ice;
		  } else if (data.event.dtls) {
			insert.data_header.event = data.event.dtls;
		  } else if (data.event.candidates) {
			insert.data_header.event = 'peerConnection';
			insert.data_header.localType = data.event.candidates.local.type;
			insert.data_header.remoteType = data.event.candidates.remote.type;
		  } else if (data.event['selected-pair']) {
			insert.data_header.event = 'peerConnection';
		  }
		  break;

		case 32:
		  /* Media Report */
		  if (data.event.media) {
			tags.medium = data.event.media;
			insert.data_header.event = data.event.media + "_report";
		  }
		  if(typeof data.event.receiving !== 'undefined') {
			insert.data_header.receiving = data.event.receiving;
		  } else if(data.event.base) {
		    metrics.increment(metrics.counter("janus", tags, 'LSR' ), data.event["lsr"] );
		    metrics.increment(metrics.counter("janus", tags, 'lost' ), data.event["lost"] || 0 );
		    metrics.increment(metrics.counter("janus", tags, 'lost-by-remote' ), data.event["lost-by-remote"] || 0 );
		    metrics.increment(metrics.counter("janus", tags, 'jitter-local' ), data.event["jitter-local"] || 0 );
		    metrics.increment(metrics.counter("janus", tags, 'jitter-remote' ), data.event["jitter-remote"] || 0);
	            metrics.increment(metrics.counter("janus", tags, 'packets-sent' ), data.event["packets-sent"] || 0);
		    metrics.increment(metrics.counter("janus", tags, 'packets-received' ), data.event["packets-sent"] || 0);
		    metrics.increment(metrics.counter("janus", tags, 'bytes-sent' ), data.event["bytes-sent"] || 0);
		    metrics.increment(metrics.counter("janus", tags, 'bytes-received' ), data.event["bytes-received"]|| 0 );
		    metrics.increment(metrics.counter("janus", tags, 'nacks-sent' ), data.event["nacks-sent"] || 0);
		    metrics.increment(metrics.counter("janus", tags, 'nacks-received' ), data.event["nacks-received"] || 0);
		  }
		  break;

		case 64:
		  /* SIP correlation */
		  if(data.event && data.event.data['call-id']) {
			db.set(data.handle_id, {cid: data.event.data['call-id']}, tll);
			insert.protocol_header.correlation_id = data.event.data['call-id'];
		  }
		  /* Videoroom */
		  if (data.event.plugin == "janus.plugin.videoroom"){

			insert.data_header.event = data.event.data.event;
			insert.data_header.user = data.event.data.display;
			insert.data_header.room = data.event.data.room;

			if (data.event.data.event == 'joined') {
				db.set(data.event.data.private_id, data.event.data.display);
				db.set(data.event.data.id, data.event.data.display);
			} else if (data.event.data.event == 'published') {
				if (db.get(data.event.data.id)) insert.data_header.user = db.get(data.event.data.id);
			} 
			if (data.event.data.event == 'subscribing') {
				db.set(data.event.data.private_id, data.event.data.display);
				if (db.get(data.event.data.private_id)) insert.data_header.user = db.get(data.event.data.private_id);
			}

			/* Directionality */
			insert.protocol_header.srcIp = data.event.plugin;
			insert.protocol_header.dstIp = "ROOM_"+data.event.data.room;
		  }
		  break;

		case 128:
		  /* Transport Event */
		  if (data.event.transport && data.event.data) {
			insert.data_header.event = data.event.transport;
			insert.data_header.transport_id = data.event.transport.id;
			db.set(data.event.transport_id, {ip: data.event.data.ip, port: data.event.data.port }, tll * 2);
			db.set('ip_'+data.session_id, {ip: data.event.data.ip, port: data.event.data.port }, tll * 2);
		  }
		  break;

		case 256:
		  break;
	    }

	    /* Lookup IP Correlation (beta) */
	    var ip = db.get(data.session_id);
	    if (ip) {
		insert.protocol_header.dstIp = ip.ip;
		insert.protocol_header.dstPort = ip.port;
	    }

	    tags.source = "janus";

	  } else if (data.type && data.event && !data.session_id){
		
		console.log('JANUS CONFIG', data);
		insert.sid = "JANUS_CORE";

	  } else if (data.event && data.event == 'producer.stats' &&  data.stats){
		// MediaSoup Media Reports
		/* Hybrid SID */
		insert.sid = data.producerId+"_"+data.peerName;
	        if (config.debug) log('%data:green MEDIASOUP PRODUCER REPORT [%s]',stringify(data) );
		tags = { roomId: data.roomId, peerName: data.peerName, producerId: data.producerId, event: data.event };
		    if (data.stats[0].mediaType) tags.media = data.stats[0].mediaType;
		    if (data.stats[0].mediaType) tags.media = data.stats[0].mimeType;
		    if (data.stats[0].type) tags.type = data.stats[0].type;
		    metrics.increment(metrics.counter("mediasoup_producer", tags, 'bitrate' ), data.stats[0]["bitrate"] );
		    metrics.increment(metrics.counter("mediasoup_producer", tags, 'byteCount' ), data.stats[0]["byteCount"] );
		    metrics.increment(metrics.counter("mediasoup_producer", tags, 'firCount' ), data.stats[0]["firCount"] );
		    metrics.increment(metrics.counter("mediasoup_producer", tags, 'fractionLost' ), data.stats[0]["fractionLost"] );
		    metrics.increment(metrics.counter("mediasoup_producer", tags, 'jitter' ), data.stats[0]["jitter"] );
	            metrics.increment(metrics.counter("mediasoup_producer", tags, 'nackCount' ), data.stats[0]["nackCount"] );
		    metrics.increment(metrics.counter("mediasoup_producer", tags, 'packetCount' ), data.stats[0]["packetCount"] );
		    metrics.increment(metrics.counter("mediasoup_producer", tags, 'packetsDiscarded' ), data.stats[0]["packetsDiscarded"] );
		    metrics.increment(metrics.counter("mediasoup_producer", tags, 'packetsLost' ), data.stats[0]["packetsLost"] );
		    metrics.increment(metrics.counter("mediasoup_producer", tags, 'packetsRepaired' ), data.stats[0]["packetsRepaired"] );
		    metrics.increment(metrics.counter("mediasoup_producer", tags, 'nacks-received' ), data.stats[0]["nacks-received"] );
		    metrics.increment(metrics.counter("mediasoup_producer", tags, 'pliCount' ), data.stats[0]["pliCount"] );
		    metrics.increment(metrics.counter("mediasoup_producer", tags, 'sliCount' ), data.stats[0]["sliCount"] );
		/* Custom Fields */
		if (data.transportId) tags.transportId = data.transportId;

	  } else if (data.event && data.event == 'transport.stats' &&  data.stats){
		// MediaSoup Media Reports
		/* Hybrid SID */
		insert.sid = data.producerId+"_"+data.peerName;
	        if (config.debug) log('%data:green MEDIASOUP TRANSPORT REPORT [%s]',stringify(data) );
		tags = { roomId: data.roomId, peerName: data.peerName, producerId: data.producerId, event: data.event };
		    if (data.stats[0].type) tags.type = data.stats[0].type;
		    /* IP Fields */
	            if (data.stats[0].iceSelectedTuple) {
			/* correlate to stats via LRU? */
			insert.proto_header = data.stats[0].iceSelectedTuple;
		        //tags.source_ = data.stats[0].iceSelectedTuple.localIP+":"+data.stats[0].iceSelectedTuple.localPort;
		        //tags.source = data.stats[0].iceSelectedTuple.remoteIP+":"+data.stats[0].iceSelectedTuple.remotePort;
		    }
		    metrics.increment(metrics.counter("mediasoup_transport", tags, 'bytesReceived' ), data.stats[0]["bytesReceived"] );
		    metrics.increment(metrics.counter("mediasoup_transport", tags, 'bytesSent' ), data.stats[0]["bytesSent"] );

		/* Custom Fields */
	        if (data.stats[0].dtlsState) tags.media = data.stats[0].dtlsState;
	        tags.source = "mediasoup";
	  }

	  // Use Tags for Protocol Search
	  // insert.data_header = tags;
	  insert.data_header = Object.assign(insert.data_header, tags);

	  //if (r_bucket) r_bucket.push(JSON.parse(dec));
	  if (buckets[key]) buckets[key].push(insert);


	} catch(err) { log('%error:red %s', err.toString() ) }
};

exports.processJson = processJson;
