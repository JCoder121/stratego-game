import socket
from _thread import *
from game import Game
import pickle

#note: server script ALWAYS has to be running on machine that IP address is, can also run client scripts on same machine as server script machine
#server ip address that we are running script on
server = "10.0.0.193" 
port = 5555

#connect to ipv4, review this command for initializing
#setup connection on port to look for connections
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)


#don't know if socket is actually going to work, so try and except
try:
    #see connection and handle it
    s.bind((server, port))

except socket.error as e:
    str(e)

#open up port so that multiple clients can connect leaving listen() as blank = unlimited connections
#in the future, can add spectators?
s.listen()

#when getting to this point, server has started (everything successful)
print("Waiting for connection, server started...")

#store IP addresses of connected clients - might not use this
connected = set()
#store games: key = id, value = game object. multiple games can go on at one time, independent of one another
games = {}
#keep track of current id connected (what game to recreate, don't override game)
idCount = 0


#threading: runs in background as server accepts clients
def threaded_client(conn, p, gameId):
    global idCount #if someone leaves/disconnects, keep track of how many people are playing globally
    """
    gameId: which game inside the game dictionary we are playing
    """
    #when we connect, first send them what player # they are
    conn.send(str.encode(str(p)))

    reply = ""
    while True:
        try:
            #client -> server: 1 of 3 different options. get, reset, or a move (R/P/S)
            #data truanced/ran out of input -> multiply by 4/8 anything
            data = conn.recv(4096).decode()

            #every time in while loop, check if game still exists (if client disconnects, delete game from dict)
            if gameId in games:
                game = games[gameId]

                if not data:
                    break
                else:
                    #check if we got reset, get or move
                    if data == "reset":
                        #client sends reset: client knows when to reset, server handles resetting game
                        game.resetWent()

                    elif data != "get":
                        #client sends move: client sends move (if allowed on client side), server updates game accordingly, send game back to client
                        game.play(p, data)


                    reply = game
                    #send the updated game to clients
                    conn.sendall(pickle.dumps(reply))
            else:
                break
        
        #in case something goes wrong with data receive, ensure server stays running
        except:
            break

    #close game and delete if out of while loop
    print("Lost connection")
    try: 
        #one player will delete game, so the other client that disconnects cannot delete it
        del games[gameId]
        print("Closing game:", gameId)
    except:
        pass

    #only -= 1 because this client is gone, not -= 2 because OTHER client still needs to delete
    idCount -= 1
    conn.close()

#when we connect, increment
currentPlayer = 0

#once setting up server, bind it, continuously look for connections and create new games
#TODO: consider instead of creating a new game, do a spectator mode, or make a menu of games to spectate on local idk
while True:
    #accept incoming connections, store conn (object) and address (IP)
    conn, addr = s.accept()
    print("Connected to:", addr)

    #keep track of how many people connected to server at once
    idCount += 1
    #current player = 0
    p = 0
    #every 2 people that connect to server - increment gameId by 1 (make 1 true game for every 2 players)
    gameId = (idCount - 1)//2
    #new player waiting for someone - need to create new game object
    if idCount % 2 == 1:
        games[gameId] = Game(gameId)
        print("Creating a new game...")
    else:
        #don't need to create game - new person connected has to be a part of the most recent game
        games[gameId].ready = True
        #update player id to send inside start new thread
        p = 1   

    #multiple connections going at once - run in background 
    start_new_thread(threaded_client, (conn, p, gameId))
    
    #use this as index into pos list
    currentPlayer += 1
