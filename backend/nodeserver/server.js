HOST = null; // localhost
PORT = 8001;

// when the daemon started
var starttime = (new Date()).getTime();

var mem = process.memoryUsage();
// every 10 seconds poll for the memory.
setInterval(function () {
  mem = process.memoryUsage();
}, 10*1000);


var fu = require("../../common/fu"),
    Breeze = require("./Breeze/Breeze"),
    ChatJS = require("./ChatJS/Channel"),
    sys = require("sys"),
    url = require("url"),
    qs = require("querystring");

var SESSION_TIMEOUT = 60 * 1000;


// [room_name] => array(sessions)
var rooms = {};

function joinRoom (room_name, nick) {
  if (room_name.length > 50) return null;
  if (/[^\w_\-^!]/.exec(room_name)) return null;
  if (nick.length > 50) return null;
  if (/[^\w_\-^!]/.exec(nick)) return null;

  // Does the room exist?
  if (typeof rooms[room_name] == 'undefined') {
    // No. Create it.
    
    sys.puts('Creating a room: '+room_name);

    var channel = new ChatJS.Channel(room_name);

    var room = { 
      room_name: room_name,
      channel: channel,
      sessions: []
    };

    rooms[room_name] = room;

    // interval to kill off old sessions
    setInterval(function () {
      var now = new Date();
      for (var id in this.sessions) {
        if (!this.sessions.hasOwnProperty(id)) continue;
        var session = this.sessions[id];

        if (now - session.timestamp > SESSION_TIMEOUT) {
          session.destroy();
        }
      }
    }.bind(room), 1000);
  }

  // Is the user already in the room?
  if (!rooms[room_name].sessions[nick]) {
    // No, join the room.
    rooms[room_name].sessions[nick] = createSession(nick, rooms[room_name]);

  } else {
    return null;
  }

  return rooms[room_name];
}

function createSession (nick, room) {
  // TODO: name length
  if (nick.length > 50) return null;
  if (/[^\w_\-^!]/.exec(nick)) return null;

  for (var i in room.sessions) {
    var session = room.sessions[i];
    if (session && session.nick === nick) return null;
  }

  var session = { 
    nick: nick, 
    timestamp: new Date(),

    poke: function () {
      session.timestamp = new Date();
    },

    destroy: function () {
      room.channel.appendMessage(session.nick, "part");
      delete room.sessions[session.nick];
    }
  };

  return session;
}

fu.listen(Number(process.env.PORT || PORT), HOST);

fu.get("/", fu.staticHandler("www/sample/index.html"));
fu.get("/style.css", fu.staticHandler("www/sample/style.css"));
fu.get("/client.js", fu.staticHandler("www/sample/client.js"));
fu.get("/jquery.js", fu.staticHandler("www/sample/jquery.js"));


fu.get("/who", function (req, res) {
  sys.puts('serv: who');
  sys.puts(' - req: '+req);
  sys.puts(' - res: '+res);
  var room_name = qs.parse(url.parse(req.url).query).room;
  var nicks = [];
  for (var id in rooms[room_name].sessions) {
    if (!rooms[room_name].sessions.hasOwnProperty(id)) continue;
    var session = rooms[room_name].sessions[id];
    nicks.push(session.nick);
  }
  res.simpleJSON(200, { nicks: nicks
                      , rss: mem.rss
                      });
});

fu.get("/join", function (req, res) {
  sys.puts('serv: join');
  sys.puts(' - query: '+url.parse(req.url).query);
  
  // Gets the room name from the URL (a GET request).
  var room_name = qs.parse(url.parse(req.url).query).room;
  if (room_name == null || room_name.length == 0) {
    res.simpleJSON(400, {error: "Bad room name."});
    return;
  }

  // TODO: Something more fun.
  var user_name = 'anon'+Math.floor(Math.random()*1000000000000);
  var room = joinRoom(room_name, user_name);
  if (room == null) {
    res.simpleJSON(400, {error: "There's already a user with your name in the room."});
    return;
  }

  sys.puts("connection: " + room_name + "@" + res.connection.remoteAddress);

  room.channel.appendMessage(user_name, "join");
  res.simpleJSON(200, { nick: user_name
                      , room: room_name
                      , rss: mem.rss
                      , starttime: starttime
                      });
});

fu.get("/part", function (req, res) {
  sys.puts('serv: part');
  var id = qs.parse(url.parse(req.url).query).nick;
  var room_name = qs.parse(url.parse(req.url).query).room;
  var room = rooms[room_name];
  var session;
  if (id && room.sessions[id]) {
    session = room.sessions[id];
    session.destroy();
  }
  res.simpleJSON(200, { rss: mem.rss });
});

fu.get("/recv", function (req, res) {
  sys.puts('serv: recv');
  if (!qs.parse(url.parse(req.url).query).since) {
    res.simpleJSON(400, { error: "Must supply since parameter" });
    return;
  }
  var id = qs.parse(url.parse(req.url).query).nick;
  var room_name = qs.parse(url.parse(req.url).query).room;
  var room = rooms[room_name];
  var session;
  if (id && room.sessions[id]) {
    session = room.sessions[id];
    session.poke();
  }

  var since = parseInt(qs.parse(url.parse(req.url).query).since, 10);

  sys.puts(room_name);

  room.channel.query(since, function (messages) {
    if (session) session.poke();
    res.simpleJSON(200, { messages: messages, rss: mem.rss });
  });
});

fu.get("/nick", function (req, res) {
  sys.puts('serv: nick');
  var nick = qs.parse(url.parse(req.url).query).nick;
  var new_nick = qs.parse(url.parse(req.url).query).new_nick;
  var room_name = qs.parse(url.parse(req.url).query).room;
  var room = rooms[room_name];

  sys.puts('old name: '+nick);
  sys.puts('new name: '+new_nick);
  
  if (new_nick.length > 50 || /[^\w_\-^!]/.exec(new_nick)) {
    res.simpleJSON(400, { error: "Invalid nickname" });
    return;
  }

  var session = room.sessions[nick];
  if (!session || !new_nick) {
    res.simpleJSON(400, { error: "No such session id" });
    return;
  }

  session.nick = new_nick;

  delete room.sessions[nick];
  room.sessions[new_nick] = session;

  session.poke();

  room.channel.appendMessage(nick, "nick", new_nick);
  res.simpleJSON(200, { rss: mem.rss });
});

fu.get("/send", function (req, res) {
  sys.puts('serv: send');
  var id = qs.parse(url.parse(req.url).query).nick;
  var room_name = qs.parse(url.parse(req.url).query).room;
  var text = qs.parse(url.parse(req.url).query).text;
  var room = rooms[room_name];

  sys.puts(id);

  var session = room.sessions[id];
  if (!session || !text) {
    res.simpleJSON(400, { error: "No such session id" });
    return;
  }

  session.poke();

  room.channel.appendMessage(session.nick, "msg", text);
  res.simpleJSON(200, { rss: mem.rss });
});
