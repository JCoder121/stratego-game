import socket
import pickle #use to send objects (serialization)

#class responsible for connecting to server
class Network:
    def __init__(self):
        self.client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        #has to be same as server file server #
        self.server = "10.0.0.193"
        self.port = 5555
        self.addr = (self.server, self.port)
        #self.id to be added for connect - store in network object to send id back and forth (player 1, player 2)
        self.p = self.connect()

    def getP(self):
        return self.p

    def connect(self):
        #want to immediately send validation/token upon initial connection
        try:
            #connect to client
            self.client.connect(self.addr)
            #could change 2048

            #when we FIRST connect to client, we get a int - 0 or 1 for player, NOT a pickle object 
            return self.client.recv(2048).decode()
        
        except:
            print('did not connect')
            pass 


    #method saves time
    def send(self, data):
        try: 
            #send string data, receive object data
            self.client.send(str.encode(data))
            #dump into pickle object, then send
            #receiving an object, decomposing object (getting actual object instead of bytes)
            return pickle.loads(self.client.recv(2048))
        except socket.error as e:
            print(e)

