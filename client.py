import pygame
from network import Network
import pickle

pygame.font.init()

width = 800
height = 800
win = pygame.display.set_mode((width, height))
pygame.display.set_caption("Stratego")

class MenuButton:
    def __init__(self, text, start_x, start_y, color):
        self.text = text
        self.x = start_x
        self.y = start_y
        self.color = color #tuple
        self.width = 250
        self.height = 100

    def draw(self, win):
        pygame.draw.rect(win, self.color, (self.x, self.y, self.width, self.height))
        font = pygame.font.SysFont("menlo", 70)
        text = font.render(self.text, 1, (255, 255, 255))
        #starting at x position, center the text (need width of text and also width of button)
        win.blit(text, (self.x + round(self.width/2) - round(text.get_width()/2), self.y + round(self.height/2) - round(text.get_height()/2)))

    #coordinate of mouse position when button clicked (button click logic)
    def click(self, pos):
        x1 = pos[0]
        y1 = pos[1]
        if self.x <= x1 <= self.x + self.width and self.y <= y1 <= self.y + self.height:
            #did press button
            return True
        else:
            return False

    def setPos(self, pos):
        self.x = pos[0]
        self.y = pos[1]

def redrawWindow(win, game, p):
    win.fill((128, 128, 128))
    #draw all logic from main

    if not(game.connected()):
        font = pygame.font.SysFont("comicsans", 80)
        text = font.render("Waiting for Player...", 1, (255, 0, 0), True) #true for bold
        win.blit(text, (width/2 - text.get_width()/2, height/2 - text.get_height()/2))

    else:
        #are connected - both players are in and draw actual buttons etc
        font = pygame.font.SysFont("comicsans", 60)
        text = font.render("Your Move", 1, (0, 255, 255))
        #static position on screen
        win.blit(text, (80, 200))

        text = font.render("Opponent's", 1, (0, 255, 255))
        #static position on screen
        win.blit(text, (380, 200))


        move1 = game.get_player_move(0)
        move2 = game.get_player_move(1)

        if game.bothWent():
            #if both players have gone, show their moves 
            text1 = font.render(move1, 1, (0,0,0))
            text2 = font.render(move2, 1, (0,0,0))

        else:
            #show only a certain player's move (show mine, don't show opponent - show locked in instead)
            if game.p1Went and p == 0:
                #player 1 went, and we are currently player 1, show my move
                text1 = font.render(move1, 1, (0,0,0))
            elif game.p1Went and p == 1:
                #otherwise, show locked in under the opponent's move
                text1 = font.render("Locked in", 1, (0,0,0))

            else:
                #waiting
                text1 = font.render("Waiting...", 1, (0,0,0))

            if game.p2Went and p == 1:
                #player 2 went, and we are currently player 2, show my move
                text2 = font.render(move2, 1, (0,0,0))
            elif game.p2Went and p == 0:
                #otherwise, show locked in under the opponent's move
                text2 = font.render("Locked in", 1, (0,0,0))

            else:
                #waiting
                text2 = font.render("Waiting...", 1, (0,0,0))


            #get correct POV in rendered client

        #player 2 logic
        if p == 1:
            win.blit(text2, (100, 350))
            win.blit(text1, (400, 350))
        else:
            #player 1 logic
            win.blit(text1, (100, 350))
            win.blit(text2, (400, 350))

        #for btn in btns:
        #    btn.draw(win)

    pygame.display.update()


#btns = [Button("Rock", 50, 500, (0, 0, 0)), Button("Scissors", 250, 500, (255, 0, 0)), Button("Paper", 450, 500, (0, 255, 0))]

def main():
    run = True
    clock = pygame.time.Clock()
    n = Network()
    #returning connected to player # (0 or 1)
    player = int(n.getP())
    print("You are player:", player)

    #main game loop in client
    while run:
        clock.tick(60)
        
        #now start to connect and ask server information for game
        try:
            #send literal "get" request for game
            game = n.send("get")
        except:
            #if we send request and don't get response from server, game doesn't exist -> exit out of current game, prompt to reconnect/start new game
            run = False
            print("Couldn't get game")
            break

        #both players went -> see who wins
        if game.bothWent():
            #draw players move
            redrawWindow(win, game, player)
            pygame.time.delay(200)
            try:
                #reset player moves if BOTH went
                game = n.send("reset")
            except:
                run = False
                print("Couldn't get game")
                break

            #now draw out winner
            font = pygame.font.SysFont("comicsans", 90)
            #different cases: winner and player
            if (game.winner() == 1 and player == 1) or (game.winner() == 0 and player == 0):
                #tell the client they won
                text = font.render("You Won!", 1, (255, 0, 0))
            elif game.winner() == -1:
                #tie
                text = font.render("Tie Game!", 1, (255, 0, 0))
            else:
                #client lost
                text = font.render("Fat L", 1, (255, 0, 0))

            win.blit(text, (width/2 - text.get_width()/2, height/2 - text.get_height()/2))
            pygame.display.update()
            pygame.time.delay(2000)

        for event in pygame.event.get():
            #hit the 'x' button at top of the corner
            if event.type == pygame.QUIT:
                run = False
                pygame.quit()

            #check if pressed mouse button down (position logic)
            if event.type == pygame.MOUSEBUTTONDOWN:
                pos = pygame.mouse.get_pos()
                for btn in btns:
                    if btn.click(pos) and game.connected():
                        #can't change move once they've made it (locked in)
                        if player == 0:
                            if not game.p1Went:
                                #make a move since p1 has not went yet
                                n.send(btn.text)

                        else:
                            if not game.p2Went:
                                n.send(btn.text)

        redrawWindow(win, game, player)


menu_btns = [MenuButton("start", 250, 300, (0, 0, 255)), MenuButton("rules", 250, 450, (0, 255, 0)), MenuButton("quit", 250, 600, (255, 0, 0))]
#create menu screen - let this be always running, call main, rules, etc
def menu_screen():
    pygame.display.set_caption("Stratego")
    run = True
    clock = pygame.time.Clock()

    while run:
        clock.tick(60)
        win.fill((75, 0, 130))
        font = pygame.font.SysFont("menlo", 120)
        text = font.render("STRATEGO", 1, (255, 255, 255))
        win.blit(text, (width/2 - text.get_width()/2, height - (height-100)))
        
        for btn in menu_btns:
            btn.draw(win)

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                run = False

            elif event.type == pygame.MOUSEBUTTONDOWN:
                for btn in menu_btns:
                    pos = pygame.mouse.get_pos()
                    if btn.click(pos) and btn.text == "start":
                        run = False

                    elif btn.click(pos) and btn.text == "rules":
                        rules_screen()

                    elif btn.click(pos) and btn.text == "quit":
                        pygame.quit()
                        run = False 
        
        pygame.display.update()

    main()

def rules_screen():
    #TODO: note = click anywhere to return to main menu
    pygame.display.set_caption("Rules of Stratego")
    while True:
        win.fill("black")
        font = pygame.font.SysFont("menlo", 120)
        text = font.render("RULES", 1, (255, 255, 255))
        win.blit(text, (width/2 - text.get_width()/2, height - (height-150)))
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                run = False
            if event.type == pygame.MOUSEBUTTONDOWN:
                menu_screen()

        pygame.display.update()


while True:
    menu_screen()




