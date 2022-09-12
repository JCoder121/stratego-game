#THIS IS UNUSED SO FAR
import pygame

#player logic lives here
class Player():
    def __init__(self, x, y, width, height, color):
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.color = color
        self.rect = (x, y, width, height)
        self.vel = 3

    def draw(self, win):
        pygame.draw.rect(win, self.color, self.rect)

    def move(self):
        #get dictionary of keys pressed
        keys = pygame.key.get_pressed()
        
        if keys[pygame.K_LEFT]:
            self.x -= self.vel


        if keys[pygame.K_RIGHT]:
            self.x += self.vel


        if keys[pygame.K_UP]:
            self.y -= self.vel


        if keys[pygame.K_DOWN]:
            self.y += self.vel

        #update every time we move directly as a player
        self.update()

    def update(self):
        #update the rect variable every time we move
        self.rect = (self.x, self.y, self.width, self.height)