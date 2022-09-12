class Game:
    def __init__(self, id):
        #keep track of if player moved
        self.p1Went = False
        self.p2Went = False

        #ready to start
        self.ready = False
        #each game has unique id
        self.id = id

        #keeping track of both players' moves
        self.moves = [None, None]

        #p1 wins, p2, wins
        self.wins = [0, 0]
        self.ties = 0

    #p is either 0 or 1 for player index
    def get_player_move(self, p):
        """
        :param p: [0, 1]
        :return: Move
        """
        return self.moves[p]

    #update moves list with that player's move
    def play(self, player, move):
        """
        :param player: [0, 1]
        :param move: Move
        :return: None
        """
        self.moves[player] = move
        #based ont he player, update if p1 or p2 went
        if player == 0:
            self.p1Went = True
        else:  
            self.p2Went = True

    #tell if ready to start game, both players are ready to move
    def connected(self):
        return self.ready

    #tell if both players locked in move
    def bothWent(self):
        return self.p1Went and self.p2Went

    #assume both players have gone (check moves against each other)
    def winner(self):
        # (R)OCK, (P)APER, (S)CISSORS - get first character instead of entire word
        p1 = self.moves[0].upper()[0]
        p2 = self.moves[1].upper()[0]

        #there could be no winner, set flag, player 1 winner - set 0, player 2 winner - set 1
        winner = -1 
        
        #rock paper scissors logic
        if p1 == "R" and p2 == "S":
            winner = 0

        elif p1 == "S" and p2 == "R":
            winner = 1

        elif p1 == "P" and p2 == "R":
            winner = 0

        elif p1 == "R" and p2 == "P":
            winner = 1

        elif p1 == "S" and p2 == "P":
            winner = 0

        elif p1 == "P" and p2 == "S":
            winner = 1

        return winner

    #reset on new game start/initialize
    def resetWent(self):
        self.p1Went = False
        self.p2Went = False


