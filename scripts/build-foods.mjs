// Builds src/data/foods.js, the app's offline food list, from the USDA National Nutrient Database
// for Standard Reference, Release 28 (SR28, public domain). SR28's own files come from the
// fda-nutrient-database npm package: ABBREV.txt (nutrients per 100 g and two household weights)
// and FOOD_DES.txt (food group codes and long descriptions).
//
// Only the foods listed in PICKS are included: the ones people actually log, under names written
// by hand. Every number is SR28's, rounded to 0.1; nothing is estimated or filled in.
//
// Run:  npm install && node scripts/build-foods.mjs
//       node scripts/build-foods.mjs --report   (also prints every food, its portions and SR28's
//                                                 description, for reviewing names)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SR = join(root, 'node_modules/fda-nutrient-database/data');
const OUT = join(root, 'src/data/foods.js');
const REPORT = process.argv.includes('--report');

// One food per line: NDB number, then  name | detail | flags | aliases
//   name     what people call it (checked against SR28's description, see nameMisses)
//   detail   optional second line: cut, preparation, brand
//   flags    1-3 = how often people log it (search ranks these first); @cat = category override
//   aliases  extra search words, comma-separated: other names, British English, brands
// "#" starts a comment; section headings name SR28's food groups. Categories otherwise follow those
// groups (see GROUP_CAT, CAT_RULES).
const PICKS = `
# ---------------------------------------------------------------- dairy and eggs (0100)
01001 Butter | salted | 2
01145 Butter, unsalted | | | sweet butter
01002 Butter, whipped | salted
01003 Ghee | clarified butter | | butter oil
01004 Blue cheese
01006 Brie cheese
01007 Camembert cheese
01009 Cheddar cheese | | 3
01270 Cheddar cheese, sharp | sliced
01260 Cheddar cheese, reduced fat
01011 Colby cheese
01012 Cottage cheese | creamed, 4% fat | 2
01015 Cottage cheese, 2% | low fat
01016 Cottage cheese, 1% | low fat
01014 Cottage cheese, nonfat | dry curd | | fat free cottage cheese
01017 Cream cheese | | 2 | philadelphia
01031 Neufchatel cheese | 1/3 less fat cream cheese | | light cream cheese
01186 Cream cheese, fat free
01018 Edam cheese
01019 Feta cheese | | 1
01020 Fontina cheese
01022 Gouda cheese
01023 Gruyere cheese
01025 Monterey Jack cheese | | | jack cheese
01026 Mozzarella, whole milk | fresh | | mozzarella cheese
01028 Mozzarella, part-skim | | 2 | string cheese, mozzarella cheese
01029 Mozzarella, low-moisture | part-skim, shredded | | pizza cheese, mozzarella cheese
01030 Muenster cheese
01032 Parmesan cheese, grated | | 1 | parmigiano
01033 Parmesan cheese, hard | block | | parmigiano reggiano
01146 Parmesan cheese, shredded
01035 Provolone cheese
01036 Ricotta, whole milk | | | ricotta cheese
01037 Ricotta, part-skim | | | ricotta cheese
01038 Romano cheese | | | pecorino
01039 Roquefort cheese
01040 Swiss cheese | | | emmental
01042 American cheese | process cheese | 1 | cheese slice, processed cheese
01252 American cheese singles | process cheese product | | kraft singles, cheese slices
01191 Velveeta | process cheese spread
01156 Goat cheese, hard
01159 Goat cheese, soft | | | chevre
01251 Mexican cheese blend | shredded
01228 Queso fresco | | | fresh cheese
01267 Cotija cheese | queso cotija
01229 Queso blanco | | | white cheese
01049 Half and half | | 1 | half & half
01050 Light cream | coffee or table cream
01053 Heavy cream | whipping cream | | double cream
01054 Whipped cream | pressurized can | | squirty cream, reddi-wip
01073 Whipped topping, frozen | nondairy | | cool whip
01056 Sour cream | | 1
01179 Sour cream, light
01180 Sour cream, fat free
01067 Coffee creamer, liquid | nondairy | | non-dairy creamer, coffee whitener
01205 Coffee creamer, flavored | nondairy, liquid | | coffee-mate
01069 Coffee creamer, powdered | nondairy | | coffee whitener
01077 Milk, whole | 3.25% fat | 3 | full fat milk, full cream milk
01079 Milk, 2% | reduced fat | 3 | semi-skimmed milk
01082 Milk, 1% | low fat | 2
01085 Milk, skim | nonfat | 2 | skimmed milk, fat free milk
01088 Buttermilk | cultured, low fat
01102 Chocolate milk | whole | 1
01103 Chocolate milk, reduced fat | 2%
01104 Chocolate milk, low fat | 1%
01106 Goat milk | | | goats milk
01095 Sweetened condensed milk | canned
01096 Evaporated milk | canned
01090 Milk powder, whole | dry
01154 Milk powder, nonfat | dry, instant | | skim milk powder, dry milk
01116 Yogurt, plain, whole milk | | | natural yogurt
01117 Yogurt, plain, low fat
01118 Yogurt, plain, nonfat | skim
01119 Yogurt, vanilla, low fat
01121 Yogurt, fruit, low fat | | 1
43261 Yogurt, fruit, nonfat
01184 Yogurt, light | vanilla or lemon, low-calorie sweetener
01256 Greek yogurt, plain, nonfat | | 3 | 0% greek yogurt
01287 Greek yogurt, plain, low fat | 2% | 2
01293 Greek yogurt, plain, whole milk
01286 Greek yogurt, vanilla, nonfat
01297 Greek yogurt, vanilla, low fat
01285 Greek yogurt, strawberry, nonfat
01284 Greek yogurt, strawberry, low fat
01294 Greek yogurt, fruit, whole milk
01289 Kefir, plain | low fat
01110 Milkshake, chocolate | thick | | shake
01111 Milkshake, vanilla | thick | | shake
01057 Eggnog
01223 Muscle Milk protein powder | milk-based | | protein powder
01224 Muscle Milk Light protein powder | milk-based | | protein powder
01225 Dulce de leche
01105 Hot chocolate | homemade with milk | | hot cocoa
01237 Ice cream bar | chocolate-coated
01238 Ice cream sandwich
01240 Ice cream cone, chocolate-dipped | with nuts | | drumstick
01236 Soft serve, chocolate | ice cream
01123 Egg | whole, raw | 3 | large egg
01129 Egg, hard-boiled | | 2 | boiled egg
01128 Egg, fried | | 2
01132 Egg, scrambled | | 2
01131 Egg, poached
01130 Omelette, plain | egg only | 1 | omelet
01124 Egg white | raw | 2
01125 Egg yolk | raw
01226 Egg substitute, liquid | fat free | | egg beaters
01136 Egg white powder | dried | | dried egg white
01138 Duck egg
01140 Quail egg
01168 Cheddar cheese, low fat | cheddar or colby
01265 Cheddar cheese, fat free
43589 Swiss cheese, low fat
42304 Mozzarella, nonfat | | | mozzarella cheese
01208 Provolone cheese, reduced fat
01209 Mexican cheese blend, reduced fat
43274 Cream cheese, low fat
01097 Evaporated milk, nonfat | canned | | evaporated skim milk
01199 Half and half, fat free
01275 Chobani Greek yogurt, vanilla | nonfat
01281 Chobani Greek yogurt, strawberry | nonfat
01278 Oikos Greek yogurt, vanilla | nonfat | | dannon oikos
01280 Oikos Greek yogurt, strawberry | nonfat | | dannon oikos
01048 Cheese spread | process American | | cheez whiz
01061 American cheese, fat free | | | cheese slice
01215 American cheese, reduced fat | process cheese product | | 2% milk singles, cheese slice
01167 Queso chihuahua | Mexican cheese
01166 Queso asadero | Mexican cheese
01165 Queso añejo | Mexican cheese
42141 Coffee creamer, light | nondairy, liquid | | coffee whitener

# ---------------------------------------------------------------- spices and vinegar (0200)
02047 Salt | table salt
02030 Black pepper | ground | | pepper
02010 Cinnamon | ground
02020 Garlic powder
02026 Onion powder
02028 Paprika
02009 Chili powder
02031 Cayenne pepper | ground red pepper
02015 Curry powder
02043 Turmeric | ground
02021 Ginger, ground | | | ground ginger
02014 Cumin seed | | | cumin
02027 Oregano, dried
02003 Basil, dried
02044 Basil, fresh
02042 Thyme, dried
02025 Nutmeg | ground
02064 Mint, fresh | peppermint
02050 Vanilla extract
02046 Mustard, yellow | prepared
02048 Apple cider vinegar | | | cider vinegar
02053 White vinegar | distilled | | vinegar
02069 Balsamic vinegar
02068 Red wine vinegar
02054 Capers | canned, drained
02055 Horseradish | prepared

# ---------------------------------------------------------------- fats, oils, dressings (0400)
04053 Olive oil | | 3 | extra virgin olive oil, evoo
04582 Canola oil | | | rapeseed oil
04044 Vegetable oil | soybean | 1 | soybean oil, cooking oil
04047 Coconut oil | | 1
04518 Corn oil
04042 Peanut oil
04058 Sesame oil
04506 Sunflower oil
04581 Avocado oil
04517 Grapeseed oil
42231 Flaxseed oil | cold pressed | | linseed oil
04589 Cod liver oil | | | fish oil
04002 Lard
04001 Beef tallow | | | dripping
04609 Bacon grease | | | bacon fat, bacon drippings
04574 Duck fat
04615 Vegetable shortening | | | crisco
04610 Margarine, stick | 80% fat
04611 Margarine, tub | 80% fat
04613 Margarine spread | 60% fat, tub
04128 Margarine spread, light | about 37% fat
04601 Butter, light | stick | | light butter
04679 Cooking spray | original | | pam, oil spray
04025 Mayonnaise | | 2 | mayo
04641 Mayonnaise, light | | | light mayo
04708 Mayonnaise with olive oil | reduced fat | | mayo
04018 Mayonnaise-type salad dressing | | | miracle whip
04639 Ranch dressing | | 2
04640 Ranch dressing, light | reduced fat
04114 Italian dressing
04021 Italian dressing, light | reduced fat
04120 French dressing
04017 Thousand Island dressing
04539 Blue cheese dressing
43015 Caesar dressing
04703 Honey mustard dressing
04135 Oil and vinegar dressing | homemade | | vinaigrette
04016 Sesame dressing | | | asian sesame dressing
04638 Ranch dressing, fat free
04636 Italian dressing, fat free
04673 Smart Balance spread | buttery spread with flax oil | | margarine
04055 Palm oil

# ---------------------------------------------------------------- poultry (0500)
05064 Chicken breast, roasted | meat only | 3
05062 Chicken breast, raw | skinless, boneless | 2
05747 Chicken breast, grilled | skinless, boneless | 3
05063 Chicken breast, pan-fried | meat only
05065 Chicken breast, stewed | meat only | | boiled chicken breast, poached chicken
05060 Chicken breast with skin, roasted
05059 Chicken breast, fried in flour | with skin
05058 Chicken breast, fried in batter | with skin
05342 Rotisserie chicken breast | meat only
05348 Rotisserie chicken breast with skin
05098 Chicken thigh, roasted | meat only | 2
05096 Chicken thigh, raw | meat only, skinless
05094 Chicken thigh with skin, roasted
05091 Chicken thigh with skin, raw
05073 Chicken drumstick, roasted | meat only
05069 Chicken drumstick with skin, roasted
05066 Chicken drumstick with skin, raw
05067 Chicken drumstick, fried in batter | with skin
05103 Chicken wing, roasted | with skin | 1
05100 Chicken wing, raw | with skin
05102 Chicken wing, fried | flour-coated, with skin | | buffalo wings
05101 Chicken wing, fried in batter | with skin
05313 BBQ chicken wings | frozen, glazed, microwaved
05013 Chicken, roasted | light and dark meat, meat only | 1 | shredded chicken, cooked chicken
05009 Chicken with skin, roasted | light and dark meat
05045 Chicken dark meat, roasted | meat only
05028 Chicken liver, cooked | simmered
05024 Chicken gizzards, cooked | simmered
05018 Chicken skin, roasted
05332 Ground chicken, raw | | | minced chicken, chicken mince
05333 Ground chicken, cooked | pan-browned | | minced chicken, chicken mince
05277 Chicken, canned | meat with broth | | tinned chicken
05337 Chicken, canned in water | meat only | | tinned chicken
05324 Chicken patty, breaded | frozen, cooked
05308 Cornish hen, roasted | meat and skin
05711 Turkey breast, roasted | meat only | 1
05710 Turkey breast, raw | meat only
05168 Turkey, roasted | light and dark meat, meat only | | roast turkey
05166 Turkey with skin, roasted | light and dark meat
05188 Turkey dark meat, roasted | meat only
05194 Turkey leg, roasted | meat and skin
05665 Ground turkey, 93% lean, raw | | 1 | minced turkey, turkey mince
05666 Ground turkey, 93% lean, cooked | pan-browned | 2 | minced turkey, turkey mince
05668 Ground turkey, 85% lean, raw | | | minced turkey
05669 Ground turkey, 85% lean, cooked | pan-browned | | minced turkey
05662 Ground turkey, 99% lean, raw | fat free | | minced turkey
05663 Ground turkey, 99% lean, cooked | fat free, pan-browned | | minced turkey
05142 Duck, roasted | meat only
05140 Duck with skin, roasted
05149 Goose, roasted | meat only
05315 Duck breast with skin, roasted | Pekin, boneless
05316 Duck breast, broiled | Pekin, meat only
43367 Smoked turkey leg | with skin, bone removed | | turkey drumstick

# ---------------------------------------------------------------- soups, sauces, gravies (0600)
06419 Chicken noodle soup | canned, prepared with water | 1
06018 Chicken noodle soup, chunky | canned, ready-to-serve
06559 Tomato soup | canned, prepared with water
06359 Tomato soup, made with milk | canned, prepared with 2% milk
06443 Cream of mushroom soup | canned, prepared with water
06416 Cream of chicken soup | canned, prepared with water
06253 Cream of potato soup | canned, prepared with milk
27042 Clam chowder | New England, canned
06039 Minestrone soup | canned, chunky
06471 Vegetable beef soup | canned, prepared with water
06067 Vegetable soup | canned, chunky
06451 Split pea soup with ham | canned, prepared with water
06402 Black bean soup | canned, prepared with water
06037 Lentil soup | with ham, canned
27062 Beef barley soup | ready-to-serve
27000 Egg drop soup | Chinese restaurant
27001 Hot and sour soup | Chinese restaurant
27002 Wonton soup | Chinese restaurant
06583 Instant ramen noodles | dry, any flavor | 1 | ramen, instant noodles, cup noodles
06194 Chicken broth | ready-to-serve | | chicken stock, bouillon
06008 Beef broth | ready-to-serve | | beef stock, bouillon
06700 Vegetable broth | ready-to-serve | | vegetable stock
06931 Marinara sauce | pasta sauce | 1 | spaghetti sauce, pasta sauce, tomato pasta sauce
06150 Barbecue sauce | | 1 | bbq sauce
06164 Salsa | | 1
27047 Salsa verde
06112 Teriyaki sauce
06175 Hoisin sauce
06176 Oyster sauce
06179 Fish sauce
06168 Hot sauce | | | pepper sauce, tabasco, franks
06631 Sriracha
06971 Worcestershire sauce
06626 Pesto | refrigerated
06930 Cheese sauce | | | nacho cheese
27052 Queso dip | salsa con queso
27049 Tartar sauce
27050 Sweet and sour sauce
27051 Cocktail sauce
27048 Steak sauce | | | a1
27059 Peanut sauce | | | satay sauce
27063 Enchilada sauce | red
06152 Pizza sauce
06116 Beef gravy | canned | | brown gravy, gravy
06119 Chicken gravy | canned
06125 Turkey gravy | canned
27046 Duck sauce
27064 Wasabi | paste
06166 White sauce | homemade | | bechamel
27065 Bean dip

# ---------------------------------------------------------------- sausages and deli meats (0700)
07022 Hot dog, beef | unheated | 1 | frankfurter, frank, wiener, hotdog
07950 Hot dog | mixed meat, unheated | | frankfurter, frank, wiener, hotdog
07025 Hot dog, turkey | | | turkey frank
07024 Hot dog, chicken
07013 Bratwurst | pork, cooked | | brat
07019 Chorizo | pork and beef
07089 Italian sausage | pork, cooked
07064 Pork sausage | link or patty, pan-fried | 1 | breakfast sausage
07958 Turkey sausage | fresh, cooked
07919 Turkey sausage, breakfast links | mild
07976 Chicken sausage | Italian style, chicken or turkey
07970 Kielbasa | fully cooked | | polish sausage
07074 Smoked sausage | pork link
07078 Summer sausage | beef and pork
07057 Pepperoni | sliced
07072 Salami | dry or hard, pork and beef
07007 Bologna, beef
07959 Bologna | chicken, pork and beef
07011 Bologna, turkey
07041 Liverwurst | pork | | liver sausage, braunschweiger
07050 Mortadella
07028 Ham, sliced | deli, extra lean | 1 | deli ham, lunch meat, cold cuts
07029 Ham, sliced, regular | deli, about 11% fat
07938 Honey ham | deli, smoked
07081 Turkey breast, sliced | deli | 2 | deli turkey, lunch meat, cold cuts, turkey slices
07043 Roast beef, sliced | deli | | deli roast beef
07961 Chicken breast, sliced | deli, rotisserie seasoned
13355 Pastrami | beef
13348 Corned beef, canned
07908 Luncheon meat, canned | pork with ham | | spam
07083 Vienna sausages | canned
07973 Turkey bacon | microwaved | 1
07972 Meatballs | frozen, Italian style
07036 Italian sausage, raw | pork
07063 Pork sausage, raw | link or patty, uncooked | | breakfast sausage
07052 Turkey pastrami
07909 SPAM Lite | pork and chicken, canned | | luncheon meat
07278 Turkey pepperoni | Hormel

# ---------------------------------------------------------------- breakfast cereals (0800)
08120 Oats | rolled or quick, dry | 3 | oatmeal, rolled oats, porridge oats, porridge, old fashioned oats, quick oats
08121 Oatmeal, cooked | with water | 2 | porridge, cooked oats
08122 Instant oatmeal, plain | dry packet | 1 | instant oats
08680 Instant oatmeal, maple and brown sugar | dry packet
08124 Instant oatmeal, apple cinnamon | dry packet
20033 Oat bran | raw
08091 Grits, cooked | white corn, with water | | hominy grits
08090 Grits, dry | white corn
08105 Cream of Wheat, cooked | farina, with water | | farina, semolina porridge
08104 Cream of Wheat, dry | farina, quick | | farina
08037 Granola | homemade | 1
08054 Granola, oats and honey | Quaker 100% Natural
43218 Muesli | Alpen
08084 Wheat germ | toasted
08013 Cheerios | General Mills | 1
08045 Honey Nut Cheerios | General Mills
08020 Corn Flakes | Kellogg's | | cornflakes
08069 Frosted Flakes | Kellogg's | | frosties
08065 Rice Krispies | Kellogg's
08067 Special K | Kellogg's
08471 Special K Protein Plus | Kellogg's
08060 Raisin Bran | Kellogg's
08029 Bran flakes | Post
08001 All-Bran | Kellogg's
08319 Frosted Mini-Wheats | Kellogg's, bite size
08030 Froot Loops | Kellogg's
08003 Apple Jacks | Kellogg's
08010 Cap'n Crunch | Quaker
08049 Life cereal | Quaker
08050 Lucky Charms | General Mills
08272 Cinnamon Toast Crunch | General Mills
08271 Cocoa Puffs | General Mills
08089 Wheaties | General Mills
08064 Rice Chex | General Mills
08038 Grape-Nuts | Post
08147 Shredded Wheat | Post, big biscuit
43570 Honey Bunches of Oats | Post, honey roasted
08034 Fruity Pebbles | Post
08244 Fiber One | General Mills
08386 Kashi GoLean Crunch
08393 Kashi GoLean
42237 Weetabix

# ---------------------------------------------------------------- fruit and juices (0900)
09003 Apple | raw, with skin | 3
09004 Apple, peeled | raw
09503 Apple, Gala | raw, with skin
09504 Apple, Fuji | raw, with skin
09502 Apple, Granny Smith | raw, with skin | | green apple
09500 Apple, Red Delicious | raw, with skin
09501 Apple, Golden Delicious | raw, with skin
09019 Applesauce, unsweetened | canned | | apple sauce
09020 Applesauce, sweetened | canned | | apple sauce
09011 Dried apples | sulfured | | apple rings
09021 Apricot | raw
09032 Dried apricots
09037 Avocado | raw, all varieties | 1 | avo
09038 Avocado, Hass | California, raw | 3 | avo
09040 Banana | raw | 3
09042 Blackberries | raw
09050 Blueberries | raw | 2
09054 Blueberries, frozen | unsweetened
09163 Dried blueberries | sweetened
09060 Starfruit | raw | | carambola
09070 Cherries | sweet, raw
09044 Dried cherries | tart, sweetened
09328 Maraschino cherries | canned, drained
09078 Cranberries | raw
09079 Dried cranberries | sweetened | | craisins
09081 Cranberry sauce | canned, sweetened
09087 Dates | Deglet Noor
09421 Medjool dates
09089 Fig | raw
09094 Dried figs
09097 Fruit cocktail | canned in juice
09110 Goji berries | dried | | wolfberries
09111 Grapefruit | raw
09132 Grapes | red or green | 2
09139 Guava | raw
09144 Jackfruit | raw
09148 Kiwi | green, raw | | kiwifruit
09150 Lemon | raw, without peel
09152 Lemon juice | fresh
09159 Lime | raw
09160 Lime juice | fresh
09164 Lychee | raw | | litchi
09176 Mango | raw | 1
09178 Dried mango | sweetened
09181 Cantaloupe | raw | | rockmelon, muskmelon, melon
09184 Honeydew melon | raw
09326 Watermelon | raw | 1
09191 Nectarine | raw
09193 Black olives | ripe, canned
09195 Green olives | pickled
09200 Orange | raw | 2
09218 Tangerine | raw | | mandarin
09433 Clementine | raw | 1 | cutie, mandarin
09219 Mandarin oranges, canned | in juice
09226 Papaya | raw
09231 Passion fruit | raw | | granadilla
09236 Peach | raw | 1
09238 Peaches, canned in juice
09241 Peaches, canned in heavy syrup
09252 Pear | raw | 1
09254 Pears, canned in juice
09263 Persimmon | Japanese, raw
09266 Pineapple | raw | 1
09268 Pineapple, canned in juice
09277 Plantain | raw
09278 Plantain, cooked
09446 Tostones | fried green plantains
09447 Maduros | fried sweet plantains | | platanos maduros
09279 Plum | raw
09291 Prunes | dried plums
09286 Pomegranate | raw | | pomegranate seeds, arils
09298 Raisins | seedless | 1
09302 Raspberries | raw | 1
09316 Strawberries | raw | 2
09318 Strawberries, frozen | unsweetened
09209 Orange juice | chilled, includes from concentrate | 2 | oj
09206 Orange juice, fresh | raw
09016 Apple juice | unsweetened | 1
09135 Grape juice | unsweetened
09123 Grapefruit juice | unsweetened
09273 Pineapple juice | unsweetened
43382 Cranberry juice | unsweetened
09294 Prune juice
09442 Pomegranate juice
09436 Mango nectar
09202 Orange, navel | raw
09048 Blackberries, frozen | unsweetened
09085 Currants, dried | Zante | | dried currants
09112 Grapefruit, pink | raw | | ruby red grapefruit
09149 Kumquats | raw
09190 Mulberries | raw
09240 Peaches, canned in light syrup
09103 Fruit salad, canned | in juice
09153 Lemon juice, bottled | from concentrate
09307 Rhubarb | raw
09518 Raspberries, frozen | unsweetened
09340 Asian pear | raw | | nashi pear
09412 Pear, Bartlett | raw
09520 Kiwi, gold | Zespri SunGold, raw | | golden kiwi
09508 Naked Juice Green Machine | fruit juice smoothie | | smoothie
09531 Naked Juice strawberry banana | fruit juice smoothie | | smoothie

# ---------------------------------------------------------------- pork (1000)
10862 Bacon | pan-fried | 2 | streaky bacon
10123 Bacon, raw | unprepared
10998 Canadian bacon | pan-fried | | back bacon
10064 Pork chop, broiled | boneless, lean and fat | 1
10186 Pork chop, pan-fried | boneless, lean and fat
10038 Pork chop, bone-in, broiled | lean and fat
10062 Pork chop, raw | boneless, lean and fat
10061 Pork tenderloin, roasted | lean
10060 Pork tenderloin, raw | lean
10065 Pork loin roast | boneless, lean and fat | | roast pork
10083 Pork shoulder, roasted | Boston butt, lean and fat | | pork butt
10940 Pork spare ribs, roasted | lean and fat | | ribs, spareribs
10193 Pork back ribs, roasted | lean and fat | | baby back ribs
10220 Ground pork, cooked | | | minced pork, pork mince
10219 Ground pork, raw | | | minced pork, pork mince
10136 Ham, roasted | boneless, about 11% fat
10134 Ham, extra lean, roasted | boneless, about 5% fat
10005 Pork belly, raw
10068 Pork chop, lean only, broiled | boneless

# ---------------------------------------------------------------- vegetables (1100)
11008 Artichoke, cooked | boiled
11011 Asparagus, raw
11012 Asparagus, cooked | boiled | 1
11028 Bamboo shoots | canned, drained
11043 Bean sprouts | mung, raw | | beansprouts
11052 Green beans, raw | | | string beans, snap beans, french beans
11053 Green beans, cooked | boiled | 1 | string beans, snap beans, french beans
11056 Green beans, canned | drained | | string beans
11080 Beets, raw | | | beetroot
11081 Beets, cooked | boiled | | beetroot
11090 Broccoli, raw | | 2
11091 Broccoli, cooked | boiled | 2
11093 Broccoli, frozen, cooked | chopped, boiled
11098 Brussels sprouts, raw
11099 Brussels sprouts, cooked | boiled
11109 Cabbage, raw | green
11110 Cabbage, cooked | boiled
11112 Red cabbage, raw | | | purple cabbage
11116 Bok choy, raw | | | pak choi
11117 Bok choy, cooked | boiled | | pak choi
11119 Napa cabbage, raw | | | chinese cabbage
11118 Kimchi
11124 Carrots, raw | | 2
11125 Carrots, cooked | boiled
11960 Baby carrots | raw
11134 Cassava, raw | | | yuca, manioc
11135 Cauliflower, raw
11136 Cauliflower, cooked | boiled
11143 Celery | raw | 1
11147 Swiss chard, raw | | | chard
11148 Swiss chard, cooked | boiled | | chard
11156 Chives | raw
11162 Collard greens, cooked | boiled | | collards
11165 Cilantro | raw | | coriander leaves, chinese parsley
11167 Corn, raw | sweet, yellow | | sweetcorn
11168 Corn, cooked | sweet, yellow, boiled | 2 | sweetcorn, corn on the cob
11172 Corn, canned | sweet, whole kernel, drained | | sweetcorn
11174 Creamed corn | canned
11205 Cucumber | raw, with peel | 2
11209 Eggplant, raw
11210 Eggplant, cooked | boiled
11212 Edamame | frozen, prepared | | soybeans
11215 Garlic | raw | 1
11216 Ginger root | raw | | fresh ginger
11233 Kale, raw
11234 Kale, cooked | boiled
11246 Leeks | raw
11251 Romaine lettuce | raw | 1 | cos lettuce
11252 Iceberg lettuce | raw
11253 Green leaf lettuce | raw
11250 Butter lettuce | raw | | bibb lettuce, boston lettuce
11260 Mushrooms, raw | white | 1 | button mushrooms, champignons
11261 Mushrooms, cooked | white, boiled
11264 Mushrooms, canned | drained
11265 Portobello mushroom, raw | | | portabella
11243 Portobello mushroom, grilled | | | portabella
11266 Cremini mushrooms | raw | | baby bella, crimini
11238 Shiitake mushrooms | raw
11987 Oyster mushrooms | raw
11279 Okra, cooked | boiled
11282 Onion | raw | 2
11283 Onion, cooked | boiled
11286 Onions, sauteed
11291 Green onions | raw | | scallions, spring onions
11677 Shallots | raw
11297 Parsley | fresh
11299 Parsnips, cooked | boiled
11300 Snow peas | raw | | sugar snap peas, snap peas, mangetout
11301 Snow peas, cooked | boiled | | sugar snap peas, snap peas, mangetout
11305 Peas, cooked | green, boiled | 1 | green peas
11313 Peas, frozen, cooked | green, boiled | | green peas
11308 Peas, canned | green, drained | | green peas
11333 Green bell pepper | raw | | capsicum, green pepper
11821 Red bell pepper | raw | 1 | capsicum, red pepper
11951 Yellow bell pepper | raw | | capsicum
11979 Jalapeño pepper | raw
11632 Jalapeños, canned | pickled
11670 Green chili pepper | raw | | chile
11352 Potato, raw | flesh and skin
11356 Potato, baked | russet, flesh and skin | 2 | baked potato, jacket potato
11358 Red potato, baked | flesh and skin
11367 Potato, boiled | peeled | 1
11934 Mashed potatoes | homemade with milk and butter | 1 | mash
11370 Hash browns | homemade
11391 Hash browns, frozen | pan-fried
11399 Tater tots | frozen, oven-baked | | potato puffs
11402 French fries, frozen | as purchased | | oven chips
11403 French fries, oven-baked | from frozen | | fries, oven chips
31023 Sweet potato fries | frozen
11414 Potato salad | homemade
11672 Potato pancake | | | latke
11296 Onion rings | frozen, oven-baked
11423 Pumpkin, cooked | boiled
11424 Pumpkin puree | canned | | canned pumpkin
11429 Radishes | raw
11430 Daikon radish | raw
11436 Rutabaga, cooked | boiled | | swede
11439 Sauerkraut | canned
11446 Nori seaweed | laver, raw | | seaweed
11667 Spirulina | dried
11457 Spinach, raw | | 2
11458 Spinach, cooked | boiled | 1
11464 Spinach, frozen, cooked | boiled
11477 Zucchini, raw | | 1
11478 Zucchini, cooked | boiled
11467 Yellow squash, raw | summer squash
11485 Butternut squash, raw
11486 Butternut squash, baked
11483 Acorn squash, baked
11493 Spaghetti squash, cooked
11507 Sweet potato, raw | | | yam, kumara
11508 Sweet potato, baked | flesh, baked in skin | 2 | yam, kumara
11510 Sweet potato, boiled | without skin | | yam, kumara
11659 Candied sweet potatoes | homemade | | candied yams
11519 Taro, cooked
11529 Tomato | red, raw | 2 | cherry tomatoes
11531 Canned tomatoes | in tomato juice | | tinned tomatoes, diced tomatoes
11693 Crushed tomatoes | canned
11546 Tomato paste | canned
11547 Tomato puree | canned
11549 Tomato sauce | canned
11955 Sun-dried tomatoes
11956 Sun-dried tomatoes in oil | drained
11957 Fennel | bulb, raw
11959 Arugula | raw | | rocket
11961 Hearts of palm | canned
11565 Turnip, cooked | boiled
11584 Mixed vegetables, frozen, cooked | boiled | 1
11583 Mixed vegetables, frozen | unprepared
11590 Water chestnuts | canned
11591 Watercress | raw
11602 Yam, cooked | boiled or baked
11603 Jicama | raw
11935 Ketchup | | 2 | catsup, tomato ketchup
11937 Pickles, dill | | | pickle, gherkins
11940 Pickles, sweet | bread and butter
11945 Sweet relish | pickle relish
43406 Yeast extract spread | | | marmite, vegemite
11540 Tomato juice | canned
11578 Vegetable juice | canned | | v8
11655 Carrot juice | canned
11015 Asparagus, canned | drained
11061 Green beans, frozen, cooked | boiled | | string beans
11084 Beets, canned | drained | | beetroot
11096 Broccoli rabe | raw | | rapini
11131 Carrots, frozen, cooked | boiled
11138 Cauliflower, frozen, cooked | boiled
11141 Celeriac | raw | | celery root
11161 Collard greens, raw | | | collards
11179 Corn, frozen, cooked | kernels, boiled | | sweetcorn
11206 Cucumber, peeled | raw
11213 Endive | raw | | frisee
11241 Kohlrabi | raw
11257 Red leaf lettuce | raw
11263 Mushrooms, sauteed | white, stir-fried
11278 Okra, raw
11294 Sweet onion | raw | | vidalia onion
11298 Parsnips, raw
11304 Peas, raw | green
11323 Peas and carrots, frozen, cooked | boiled
11353 Potato, russet, raw | flesh and skin
11355 Red potato, raw | flesh and skin
11363 Potato, baked, flesh only | without skin
11373 Au gratin potatoes | homemade
11844 Scalloped potatoes | homemade
11379 Instant mashed potatoes | prepared with milk and butter | | mashed potatoes
11422 Pumpkin, raw
11445 Kelp | raw | | seaweed, kombu
11669 Wakame | raw | | seaweed
11468 Yellow squash, cooked | boiled | | summer squash
11492 Spaghetti squash, raw
11533 Stewed tomatoes | canned
11537 Tomatoes with green chilies | canned | | rotel
11569 Turnip greens, cooked | boiled
11609 Pickled beets | canned | | beetroot
11675 Potato, microwaved | flesh and skin
11819 Red chili pepper | raw | | chile
11950 Enoki mushrooms | raw
11952 Radicchio | raw
11954 Tomatillos | raw
11963 Nopales | raw | | cactus
11972 Lemongrass | raw
11976 Banana pepper | raw

# ---------------------------------------------------------------- nuts and seeds (1200, peanuts 1600)
12061 Almonds | raw | 3
12063 Almonds, dry roasted
12206 Almonds, honey roasted
12195 Almond butter | | 1
12078 Brazil nuts
12087 Cashews | raw | 1
12085 Cashews, dry roasted
12088 Cashew butter
12120 Hazelnuts | | | filberts
12131 Macadamia nuts | raw
12135 Mixed nuts | dry roasted, with peanuts | 1
12138 Mixed nuts, no peanuts | oil roasted
12142 Pecans
12147 Pine nuts | dried | | pignoli
12151 Pistachios | raw
12152 Pistachios, dry roasted
12155 Walnuts | English | 2
12167 Chestnuts, roasted
12104 Coconut | raw meat
12108 Coconut, shredded, unsweetened | desiccated | | desiccated coconut
12179 Coconut, shredded, sweetened
12118 Coconut milk, canned
12006 Chia seeds | dried | 1
12220 Flaxseed | | | linseed, flax seeds
12012 Hemp seeds | hulled | | hemp hearts
12014 Pumpkin seeds | dried kernels | | pepitas
12016 Pumpkin seeds, roasted | kernels | | pepitas
12023 Sesame seeds | whole, dried
12036 Sunflower seeds | dried kernels
12037 Sunflower seeds, roasted | dry roasted kernels
12040 Sunflower seed butter | | | sunbutter
12166 Tahini | | | sesame paste, tahina
16087 Peanuts | raw
16090 Peanuts, dry-roasted | | 1
16089 Peanuts, oil-roasted
16098 Peanut butter, smooth | | 3 | creamy peanut butter, pb
16097 Peanut butter, crunchy | | | chunky peanut butter
16150 Peanut butter, reduced fat
16099 Peanut flour | defatted | | powdered peanut butter, pb2

# ---------------------------------------------------------------- beef (1300)
23572 Ground beef, 80% lean, raw | 80/20 | 2 | minced beef, mince, hamburger meat
23575 Ground beef, 80% lean, cooked | pan-browned | 2 | minced beef, mince
23567 Ground beef, 85% lean, raw | 85/15 | | minced beef, mince
23570 Ground beef, 85% lean, cooked | pan-browned | 2 | minced beef, mince
23562 Ground beef, 90% lean, raw | 90/10 | 1 | minced beef, mince
23565 Ground beef, 90% lean, cooked | pan-browned | | minced beef, mince
23472 Ground beef, 93% lean, raw | 93/7 | | minced beef, mince
23476 Ground beef, 93% lean, cooked | pan-browned | | minced beef, mince
23557 Ground beef, 95% lean, raw | 95/5 | | minced beef, mince
23560 Ground beef, 95% lean, cooked | pan-browned | | minced beef, mince
23220 Ground beef, cooked | fat content unknown | | minced beef, mince
13047 Ground beef, grass-fed, raw | | | minced beef, mince
23568 Hamburger patty | 85% lean, broiled | 1 | burger patty, beef patty
23227 Ribeye steak, grilled | boneless, lean and fat | 1 | rib eye
23230 Ribeye steak, raw | boneless, lean and fat | | rib eye
13451 Sirloin steak, broiled | top sirloin, lean and fat | 2
13929 Sirloin steak, raw | top sirloin, lean and fat
23611 Sirloin steak, lean only, raw | top sirloin
13445 Strip steak, grilled | top loin, lean and fat | | new york strip, ny strip, kansas city strip
23339 Strip steak, raw | top loin, lean and fat | | new york strip
13439 Filet mignon, grilled | beef tenderloin, lean and fat | | tenderloin steak
23342 Filet mignon, raw | beef tenderloin, lean and fat | | tenderloin steak
13473 T-bone steak, broiled | lean and fat
13067 Flank steak, broiled | lean and fat
13065 Flank steak, raw | lean and fat
23214 Skirt steak, grilled | inside skirt, lean and fat
13953 Tri-tip, roasted | lean and fat
13491 Top round steak, grilled | lean | | london broil
13415 Eye of round roast | roasted, lean and fat | | roast beef
13367 Brisket, braised | whole, lean and fat | | beef brisket
13373 Pot roast | chuck arm, braised, lean and fat | | chuck roast
13148 Short ribs, braised | lean and fat | | beef short ribs
23090 Beef stew meat, cooked | chuck, braised
23093 Beef stew meat, raw | chuck
13327 Beef liver, pan-fried | | | liver
13347 Corned beef | brisket, cooked
19002 Beef jerky | | 1 | jerky
13459 Porterhouse steak, broiled | lean and fat
13340 Beef tongue, cooked | simmered | | lengua

# ---------------------------------------------------------------- drinks (1400)
14003 Beer, regular | | 2 | lager, ale
14006 Beer, light | | 1 | lite beer
14004 Budweiser | beer | | bud
14007 Bud Light | light beer
14005 Budweiser Select | light beer
14013 Beer, light, low carb | | | michelob ultra
14251 Beer, strong | higher alcohol | | craft beer, ipa
14305 Non-alcoholic beer | malt beverage | | alcohol-free beer
14239 Hard lemonade | malt beverage | | mikes hard lemonade
14250 Hard cider | | | cider
14096 Red wine | | 1 | wine
14106 White wine | | 1 | wine
14253 Rose wine | | | wine
14602 Merlot | red wine
14097 Cabernet Sauvignon | red wine
14099 Pinot Noir | red wine
14102 Zinfandel | red wine
14100 Syrah | red wine | | shiraz
14160 Chardonnay | white wine
14134 Sauvignon Blanc | white wine
14113 Pinot Grigio | white wine | | pinot gris
14132 Riesling | white wine
43155 Light wine | reduced alcohol
14553 Non-alcoholic wine | | | alcohol-free wine
14057 Dessert wine | sweet | | port
43479 Sake | rice wine
14037 Liquor, 80 proof | gin, rum, vodka, whiskey | 1 | spirits, hard liquor, tequila, shot
14051 Vodka | 80 proof
14050 Rum | 80 proof
14049 Gin | 90 proof
14052 Whiskey | 86 proof | | whisky, bourbon, scotch
14414 Coffee liqueur | | | kahlua
14415 Cream liqueur | coffee with cream | | irish cream, baileys
14010 Daiquiri | homemade
14017 Pina colada | homemade
14019 Tequila sunrise | canned
14531 Whiskey sour
14148 Cola | | 2 | coke, coca-cola, pepsi, soda, pop, soft drink
14416 Diet cola | aspartame | 1 | diet coke, coke zero, pepsi max, diet soda
14144 Lemon-lime soda | | 1 | sprite, 7-up, pop
14143 Diet soda | non-cola | | diet sprite, diet 7-up
14136 Ginger ale | | | soda
14157 Root beer | | | soda
14150 Orange soda | | | fanta
14153 Pepper-type soda | | | dr pepper
14155 Tonic water
14121 Club soda | | | soda water, sparkling water, seltzer
14154 Red Bull | energy drink | 1
14156 Red Bull, sugar free | energy drink
14627 Monster Energy | energy drink
14460 Gatorade | sports drink | 1 | isotonic
14644 Gatorade G2 | low calorie sports drink
14461 Powerade | sports drink
14209 Coffee | brewed | 3 | black coffee, filter coffee, americano
14210 Espresso
14201 Decaf coffee | brewed | | decaffeinated coffee
14215 Instant coffee | prepared with water
14179 Coffee drink, bottled | milk-based, sweetened | | iced coffee, frappuccino
14183 Iced mocha, bottled | milk-based | | iced coffee
14355 Black tea | brewed | | tea
14278 Green tea | brewed | 1 | tea
14381 Herbal tea | brewed | | tisane
14545 Chamomile tea | brewed
14199 Iced tea, sweetened | bottled, lemon | | sweet tea
14207 Iced tea, diet | bottled, lemon
14194 Hot chocolate, from mix | prepared with water | | hot cocoa, cocoa
14242 Cranberry juice cocktail
14264 Fruit punch | | | hawaiian punch
14293 Lemonade
14090 Coconut water
14091 Almond milk, unsweetened | | 2
14016 Almond milk, vanilla | sweetened
14639 Rice milk | unsweetened
14171 Coconut milk drink | sweetened, fortified | | coconut milk beverage
14066 Whey protein powder | | 3 | protein powder, whey, protein shake
14058 Whey protein isolate | powder | | protein powder, whey isolate
14067 Soy protein powder | | | protein powder
14036 Muscle Milk | protein shake, ready-to-drink | | protein shake
14062 Ensure | nutrition shake | | meal replacement
14347 Milkshake, vanilla, fast food | | | shake
14428 Milkshake, strawberry, fast food | | | shake
14411 Water | tap | 1 | tap water, bottled water
14605 Vitamin water | sweetened
14638 Horchata | restaurant
14022 Monster Energy, low carb | energy drink | | lo-carb monster
14041 Boost Plus | nutritional drink | | meal replacement
14044 SlimFast High Protein shake | ready-to-drink | | meal replacement
14045 SlimFast shake | ready-to-drink | | meal replacement
14033 EAS whey protein powder | | | protein powder
14054 Almond milk, chocolate
14130 Cream soda | | | soda
14142 Grape soda | | | soda
14145 Sprite | lemon-lime soda
14167 Powerade Zero | zero calorie sports drink | | sports drink
14185 Oolong tea | brewed
14206 Green tea, bottled | sweetened | | iced green tea
14214 Instant coffee powder | dry
14192 Hot chocolate mix | powder | | cocoa mix
14462 Propel Zero | flavored water
14475 Arizona iced tea | lemon
14629 Rockstar | energy drink
14649 Hibiscus tea | brewed
43528 Ensure Plus | nutrition shake | | meal replacement

# ---------------------------------------------------------------- fish and seafood (1500)
15237 Salmon, cooked | Atlantic, farmed | 3
15236 Salmon, raw | Atlantic, farmed | 1
15209 Salmon, wild, cooked | Atlantic
15086 Salmon, sockeye, cooked | | | red salmon
15260 Salmon, canned | pink, drained | | tinned salmon
15179 Smoked salmon | lox | | nova
15121 Tuna, canned in water | light, drained | 2 | tinned tuna, tuna fish
15126 Tuna, albacore, canned in water | white, drained | | tinned tuna, white tuna
15119 Tuna, canned in oil | light, drained | | tinned tuna
15127 Tuna, fresh, raw | yellowfin | | ahi
15221 Tuna steak, cooked | yellowfin | | ahi
15128 Tuna salad
15016 Cod, cooked | Atlantic | 1
15015 Cod, raw | Atlantic
15034 Haddock, cooked
15037 Halibut, cooked
15262 Tilapia, cooked | | 1
15261 Tilapia, raw
15067 Pollock, cooked | Alaska
15235 Catfish, cooked | farmed
15102 Snapper, cooked
15092 Sea bass, cooked
15111 Swordfish, cooked
15241 Rainbow trout, cooked | farmed | | trout
15047 Mackerel, cooked | Atlantic
15029 Flounder, cooked | flounder or sole | | sole
15011 Catfish, fried | breaded
15194 Mahi mahi, cooked | | | dolphinfish
15088 Sardines | canned in oil
15002 Anchovies | canned in oil
15041 Pickled herring
15027 Fish sticks | frozen, prepared | | fish fingers
15138 Imitation crab | surimi | | crab sticks, kani
15012 Caviar
15151 Shrimp, cooked | | 2
15149 Shrimp, raw
15150 Shrimp, breaded and fried | | | fried shrimp, popcorn shrimp
15137 King crab, cooked | Alaska | | crab legs
15140 Crab meat, cooked | blue crab | | crab
15142 Crab cakes | homemade
15148 Lobster, cooked
15159 Clams, cooked
15165 Mussels, cooked
15167 Oysters, raw | eastern, wild
90240 Scallops, cooked | steamed
15172 Scallops, raw
15176 Calamari, fried | squid
15230 Octopus, cooked
15146 Crawfish, cooked | | | crayfish
15032 Grouper, cooked
15061 Perch, cooked
15071 Rockfish, cooked | Pacific
15082 Salmon, coho, cooked | wild | | silver salmon
15089 Sardines in tomato sauce | canned
15124 Tuna, albacore, canned in oil | white, drained | | tinned tuna
15133 Whiting, cooked
15141 Crab meat, canned | blue crab
15152 Shrimp, canned
15158 Clams, fried | breaded
15160 Clams, canned | drained
15168 Oysters, fried | breaded
15169 Oysters, cooked | eastern, wild

# ---------------------------------------------------------------- beans, lentils, soy (1600)
16006 Baked beans | canned, vegetarian | 1
16009 Baked beans with pork | canned
16015 Black beans, cooked | boiled | 2
16018 Black beans, canned
16014 Black beans, dry
16028 Kidney beans, cooked | boiled | 1 | red beans
16145 Kidney beans, canned | drained | | red beans
16027 Kidney beans, dry
16038 Navy beans, cooked | boiled
16043 Pinto beans, cooked | boiled
16146 Pinto beans, canned | drained
16042 Pinto beans, dry
16050 White beans, cooked | boiled | | cannellini beans
16053 Fava beans, cooked | boiled | | broad beans
16057 Chickpeas, cooked | boiled | 2 | garbanzo beans, garbanzo, chick peas, chana
16359 Chickpeas, canned | drained, rinsed | | garbanzo beans, garbanzo, chick peas
16056 Chickpeas, dry | | | garbanzo beans, garbanzo
16063 Black-eyed peas, cooked | boiled | | cowpeas
16069 Lentils, dry
16070 Lentils, cooked | boiled | 2
16144 Red lentils, dry | | | masoor dal
16072 Lima beans, cooked | large, boiled | | butter beans
16081 Mung beans, cooked | boiled
16086 Split peas, cooked | boiled
16109 Soybeans, cooked | boiled
16111 Soy nuts | dry roasted
16103 Refried beans | canned | 1
22904 Chili with beans | canned | 1 | chili con carne
22911 Chili, no beans | canned
16158 Hummus | store-bought | 2 | houmous, hommus
16137 Hummus, homemade
16138 Falafel | homemade
16126 Tofu, firm | | 2
16159 Tofu, extra firm
16127 Tofu, soft
16161 Tofu, silken | soft
16129 Tofu, fried
16114 Tempeh
16113 Natto
16122 Soy protein isolate | powder | | protein powder
16147 Veggie burger | soy patty | | vegetarian burger, veggie patty
16107 Veggie sausage | meatless | | vegetarian sausage
43130 Veggie hot dog | meatless | | vegetarian hot dog
16139 Soy milk | original or vanilla, fortified | 1 | soymilk, soya milk
16222 Soy milk, unsweetened | fortified | | soymilk, soya milk
16123 Soy sauce | | 1 | shoyu
16124 Tamari
16424 Soy sauce, low sodium | | | lite soy sauce, reduced sodium soy sauce
16112 Miso
16157 Chickpea flour | | | besan, gram flour
16082 Glass noodles, dry | mung bean | | cellophane noodles, bean thread noodles

# ---------------------------------------------------------------- lamb, veal, game (1700)
17225 Ground lamb, cooked | broiled | | minced lamb, lamb mince
17231 Leg of lamb, roasted | lean and fat
17237 Lamb chop, broiled | loin, lean and fat
17241 Rack of lamb, roasted | rib, lean and fat
17245 Lamb shoulder, roasted | lean and fat
17425 Veal cutlet, grilled | boneless
17096 Veal cutlet, breaded | pan-fried | | schnitzel, wiener schnitzel
17437 Veal chop, grilled | lean and fat
17157 Bison, roasted | lean | | buffalo
17331 Ground bison, cooked | | | buffalo burger
17165 Venison, roasted | | | deer
17344 Ground venison, cooked
17167 Elk, roasted
17169 Goat, roasted
17178 Rabbit, roasted

# ---------------------------------------------------------------- bread and baked goods (1800)
18001 Bagel, plain | | 2
18968 Bagel, wheat
28322 Bagel, multigrain
18005 Bagel, cinnamon raisin
18009 Biscuit | buttermilk, frozen, baked | | buttermilk biscuit
18019 Banana bread | homemade
18023 Cornbread | from mix
18029 French bread | includes sourdough | | baguette, sourdough
18033 Italian bread
28397 Multigrain bread | | | multi-grain bread
18041 Pita bread, white | | | pita
18042 Pita bread, whole wheat | | | pita
18044 Pumpernickel bread
18047 Raisin bread
18060 Rye bread
18064 Wheat bread
18069 White bread | | 3
18070 White bread, toasted | | | toast
18075 Whole wheat bread | | 3 | wholemeal bread, brown bread, whole grain bread
18076 Whole wheat bread, toasted | | | toast
18057 Light bread, white | reduced calorie
18055 Light bread, wheat | reduced calorie
28316 Sprouted wheat bread | | | ezekiel bread
18971 Potato bread
28336 Gluten-free bread | white
18963 Garlic bread | frozen
18973 Focaccia
18955 Pan dulce
18079 Breadcrumbs | dry, plain | | bread crumbs, panko
18080 Breadsticks | | | grissini
18243 Croutons | seasoned
18082 Stuffing | from mix | | dressing
18258 English muffin | plain | 1
18266 English muffin, whole wheat
18342 Dinner roll | | | bread roll
18348 Dinner roll, whole wheat
28348 Sweet dinner roll | | | hawaiian rolls
18350 Hamburger bun | also hot dog bun | 1 | bun, burger bun, hot dog bun
28313 Hamburger bun, whole wheat | | | bun
18353 Kaiser roll | hard roll
18363 Corn tortilla | | 1
18364 Flour tortilla | | 2 | wrap
28295 Whole wheat tortilla | | | wrap
18360 Taco shells
18952 Tostada shells
28307 Naan | | | nan bread
28287 Naan, whole wheat
28306 Chapati | plain | | roti
28285 Chapati, whole wheat | frozen | | roti
28286 Paratha | whole wheat, frozen
18293 Pancakes | homemade | 1 | hotcakes
18290 Pancakes, from mix | complete mix, prepared
18367 Waffle | homemade
18365 Waffle, frozen | toaster | | eggo
18269 French toast | homemade
18086 Angel food cake
18096 Chocolate cake | with chocolate frosting
18140 Yellow cake | with chocolate frosting
18120 Pound cake | butter
18104 Coffee cake | cinnamon crumb
18127 Snack cake, chocolate | creme-filled | | cupcake, hostess
18128 Snack cake, sponge | creme-filled | | twinkie
18147 Cheesecake
18969 Eclair | custard-filled | | cream puff
18151 Brownie
18159 Chocolate chip cookie | | 1
18378 Chocolate chip cookie, homemade | made with butter
18166 Chocolate sandwich cookie | creme-filled | | oreo
18170 Fig bar | | | fig newton
18172 Gingersnaps
18173 Graham crackers
18178 Oatmeal cookie
18185 Peanut butter cookie
18192 Shortbread cookie
18204 Sugar cookie
18213 Vanilla wafers | | | nilla wafers
18171 Fortune cookie
28399 Animal crackers
28351 Marie biscuit
28350 Chocolate biscuit sticks | | | pocky
18214 Cheese crackers | | | cheez-it
28331 Fish-shaped crackers | | | goldfish
18228 Saltine crackers | | | saltines, soda crackers
18621 Ritz crackers | | | butter crackers
18232 Wheat crackers | | | wheat thins
18235 Whole wheat crackers | | | triscuit
18216 Rye crispbread | | | ryvita, wasa
28327 Water crackers | | | water biscuits
18217 Matzo
18220 Melba toast
18239 Croissant | butter | 1
18245 Danish pastry | cheese
18358 Cinnamon roll | with frosting | | cinnamon bun
18255 Donut, glazed | yeast-leavened | 1 | doughnut
18250 Donut, cake, glazed | | | doughnut
18248 Donut, cake, plain | | | doughnut, old fashioned
18249 Donut, chocolate frosted | cake-type | | doughnut
18256 Donut, jelly-filled | | | doughnut
18254 Donut, cream-filled | | | doughnut, boston cream
18274 Blueberry muffin | | | muffin
18279 Corn muffin
18301 Apple pie
18308 Cherry pie
18324 Pecan pie
18326 Pumpkin pie
18362 Toaster pastry, fruit | | | pop-tart
18361 Toaster pastry, brown sugar cinnamon | | | pop-tart
18015 Biscuit, refrigerated dough | baked | | grands
18027 Challah | egg bread | | egg bread
18039 Oatmeal bread
18141 Yellow cake with vanilla frosting | | | birthday cake, vanilla cake
18155 Butter cookies
18160 Chocolate chip cookie, soft
18184 Oatmeal raisin cookie | homemade
18210 Vanilla sandwich cookie | creme-filled | | golden oreo
18211 Puff pastry | baked
18231 Peanut butter crackers | sandwich crackers | | lance, nabs
18271 Ice cream cone, wafer | cake cone
18272 Ice cream cone, sugar | rolled cone
18283 Oat bran muffin
18288 Pancakes, frozen | ready-to-heat | | frozen pancakes
18305 Blueberry pie
18310 Chocolate cream pie
18320 Lemon meringue pie
18338 Phyllo dough | | | filo
18354 Apple strudel
18376 Breadcrumbs, seasoned | dry

# ---------------------------------------------------------------- sweets, spreads, sugar (1900)
19155 Snickers | candy bar
19141 M&M's | milk chocolate
19140 M&M's, peanut
19150 Reese's Peanut Butter Cups
19151 Reese's Pieces
19109 Kit Kat | | | kitkat
19160 Twix
19135 Milky Way
19159 3 Musketeers | | | three musketeers
19069 Butterfinger
19065 Almond Joy
19142 Mounds
19111 Baby Ruth
19923 PayDay
19145 Nestle Crunch
19091 York Peppermint Pattie
19152 Rolo
19254 Dove milk chocolate
19255 Dove dark chocolate
19064 Tootsie Roll
19112 Twizzlers | strawberry twists | | licorice
19370 Skittles
19156 Starburst
19001 Toblerone
19116 Marshmallows
19108 Jelly beans | | | jellybeans
19106 Gumdrops | | | gum drops
19919 Fruit snacks | | | gummies, gummy bears
19014 Fruit leather | | | fruit roll-up, fruit roll
19107 Hard candy | | | lollipop
19070 Butterscotch candy
19074 Caramels
19100 Fudge | chocolate
19148 Peanut brittle
19383 Toffee
19117 Halva | | | halavah, halvah
19163 Chewing gum | | | bubble gum, gum
43060 Chewing gum, sugarless | | | gum, sugar free gum
19120 Milk chocolate | | 1 | chocolate bar, hersheys
19132 Milk chocolate with almonds
19902 Dark chocolate, 45-59%
19903 Dark chocolate, 60-69%
19904 Dark chocolate, 70-85% | | 1
19087 White chocolate
19080 Chocolate chips | semisweet
19126 Chocolate-covered peanuts
19127 Chocolate-covered raisins
19095 Ice cream, vanilla | | 1
19270 Ice cream, chocolate
19271 Ice cream, strawberry
19089 Ice cream, vanilla, premium | rich
19088 Ice cream, vanilla, light
19090 Soft serve, vanilla | | | ice cream, frozen custard
19293 Frozen yogurt | vanilla, soft-serve | | froyo
19097 Sherbet | orange
19283 Ice pop | | | popsicle, ice lolly
19263 Fruit juice bar | frozen
19183 Chocolate pudding | snack cup
19201 Vanilla pudding | snack cup
19193 Rice pudding
19218 Tapioca pudding
19173 Gelatin dessert | prepared | | jello, jell-o, jelly
19176 Gelatin dessert, sugar free | prepared | | jello, jell-o
19094 Flan | caramel custard
19168 Custard | baked
19182 Chocolate mousse
19125 Chocolate hazelnut spread | | | nutella
19296 Honey | | 2
19297 Jam | preserves | 1 | preserves, jelly
19300 Jelly | | | grape jelly
19303 Marmalade | orange
19353 Maple syrup | | 1
19129 Pancake syrup | | | syrup
19128 Pancake syrup, light | reduced calorie | | syrup
19912 Agave syrup | | | agave nectar
19304 Molasses
19348 Hot fudge sauce | | | fudge sauce
19364 Caramel sauce | butterscotch topping
14181 Chocolate syrup
19226 Chocolate frosting | ready-to-eat
19230 Vanilla frosting | ready-to-eat
19335 Sugar | white, granulated | 2 | table sugar, white sugar
19334 Brown sugar
19336 Powdered sugar | | | icing sugar, confectioners sugar
19868 Sucralose sweetener | Splenda packets | | splenda, sweetener
19337 Aspartame sweetener | Equal packets | | equal, sweetener
19165 Cocoa powder | unsweetened
19177 Gelatin, unflavored | dry powder
19078 Baking chocolate | unsweetened squares | | unsweetened chocolate
19123 Chocolate pudding, instant | made with 2% milk
19186 Apple crisp | homemade
19235 Chocolate pudding, fat free | snack cup
19260 Ice cream, vanilla, no sugar added | light
19350 Corn syrup, light
43158 Saccharin sweetener | Sweet'N Low packets | | sweet n low, sweetener
43026 Sugar-free syrup | | | syrup
43028 Jam, sugar-free | | | jelly

# ---------------------------------------------------------------- grains, rice, pasta (2000)
20045 White rice, cooked | long-grain | 3 | rice, steamed rice, boiled rice
20044 White rice, uncooked | long-grain, dry | 1 | rice
20053 White rice, short-grain, cooked | | | sushi rice
20055 Sticky rice, cooked | glutinous | | glutinous rice
20049 Instant rice, cooked | | | minute rice
20037 Brown rice, cooked | long-grain | 2
20036 Brown rice, uncooked | long-grain, dry
20089 Wild rice, cooked
20137 Quinoa, cooked | | 2
20035 Quinoa, uncooked | dry
20029 Couscous, cooked
20028 Couscous, dry
20006 Barley, cooked | pearled
20005 Barley, dry | pearled
20013 Bulgur, cooked
20010 Buckwheat groats, cooked | roasted | | kasha
20032 Millet, cooked
20141 Spelt, cooked
20002 Amaranth, cooked
20077 Wheat bran | crude
20068 Tapioca pearls | dry | | boba
20027 Cornstarch | | | corn starch, cornflour
20081 All-purpose flour | white, enriched | | white flour, plain flour, flour
20080 Whole wheat flour | | | wholemeal flour
20083 Bread flour | white, enriched
20061 Rice flour | white
20017 Masa harina | corn flour, enriched
20022 Cornmeal | yellow, degermed
20120 Pasta, dry | spaghetti, macaroni, penne | 2 | spaghetti, macaroni, penne, noodles, fusilli, rotini, linguine, fettuccine
20121 Pasta, cooked | spaghetti, macaroni, penne | 3 | spaghetti, macaroni, penne, noodles, fusilli, rotini, linguine, fettuccine
20124 Whole wheat pasta, dry | | | wholemeal pasta, whole grain spaghetti
20125 Whole wheat pasta, cooked | | 1 | wholemeal pasta, whole grain spaghetti
20094 Fresh pasta, cooked | refrigerated
20523 Protein pasta, cooked | protein-fortified spaghetti
20622 Protein pasta, dry | protein-fortified spaghetti
20092 Gluten-free pasta, cooked | corn
20110 Egg noodles, cooked
20134 Rice noodles, cooked | | | rice vermicelli, pad thai noodles
20133 Rice noodles, dry | | | rice vermicelli
20115 Soba noodles, cooked | | | buckwheat noodles
48052 Vital wheat gluten | | @protein
20030 Hominy | canned, white
20012 Bulgur, dry
20047 Parboiled rice, cooked | long-grain | | converted rice, uncle bens
20051 White rice, medium-grain, cooked | | | calrose
20058 White rice, steamed | Chinese restaurant
20066 Semolina | enriched
20109 Egg noodles, dry
20113 Chow mein noodles | crispy, dry
20132 Oat flour
20143 Teff, cooked

# ---------------------------------------------------------------- fast food (2100)
21299 Pizza, cheese | 14" chain pizza, regular crust | 2 | cheese pizza, pizza slice
21302 Pizza, pepperoni | 14" chain pizza, regular crust | 2 | pepperoni pizza
21304 Pizza, supreme | meat and vegetables, regular crust | | supreme pizza, combination pizza
21484 Pizza, sausage | regular crust
21301 Pizza, cheese, thin crust | 14" chain pizza
21511 Pizza, cheese, stuffed crust | 14" chain pizza
21224 Frozen pizza, cheese | regular crust, cooked
22903 Frozen pizza, pepperoni | regular crust, cooked
21474 Frozen pizza, cheese | DiGiorno rising crust, baked
21477 Frozen pizza, pepperoni | DiGiorno rising crust, baked
21277 Pizza, cheese | Domino's 14" hand-tossed
21280 Pizza, pepperoni | Domino's 14" hand-tossed
21293 Pizza, cheese | Pizza Hut 14" hand-tossed
21296 Pizza, pepperoni | Pizza Hut 14" hand-tossed
21283 Pizza, cheese | Papa John's 14" original crust
21284 Pizza, pepperoni | Papa John's 14" original crust
21287 Pizza, cheese | Little Caesars 14" regular crust
21288 Pizza, pepperoni | Little Caesars 14" regular crust
21108 Hamburger | fast food, single patty, with condiments | 1 | burger
21090 Cheeseburger | fast food, single patty, with condiments | 1 | burger
21395 Double cheeseburger | fast food, with condiments | | burger
21113 Hamburger, large | fast food, large patty, with vegetables | | burger, quarter pounder
21398 Cheeseburger, large | fast food, large patty, with condiments | | burger
21237 Big Mac | McDonald's | 1 | burger
21228 Hamburger | McDonald's | | burger
21233 Cheeseburger | McDonald's | | burger
21235 Quarter Pounder with Cheese | McDonald's | | burger
21344 Double cheeseburger | McDonald's | | burger
21309 Chicken McNuggets | McDonald's | 1 | nuggets
21355 McChicken | McDonald's
21232 Filet-O-Fish | McDonald's
21238 French fries | McDonald's | 1 | fries, chips
21357 Egg McMuffin | McDonald's
21359 Sausage McMuffin with Egg | McDonald's
21319 Hash brown | McDonald's
21321 Hotcakes | McDonald's, plain | | pancakes
21338 McFlurry with M&M's | McDonald's
21339 McFlurry with Oreo | McDonald's
21324 Baked apple pie | McDonald's
21252 Whopper | Burger King | | burger
21253 Whopper with cheese | Burger King | | burger
21249 French fries | Burger King | | fries, chips
21259 Chicken sandwich | Burger King, original
21510 Dave's Single | Wendy's quarter-pound hamburger | | burger
21246 Chicken nuggets | Wendy's | | nuggets
21247 French fries | Wendy's | | fries, chips
21248 Frosty | Wendy's, frozen dairy dessert
21260 Crunchy taco | Taco Bell, beef
21261 Soft taco | Taco Bell, beef
21264 Bean burrito | Taco Bell
21265 Burrito Supreme | Taco Bell, beef
21268 Nachos | Taco Bell
21434 Fried chicken breast | KFC Original Recipe
21435 Fried chicken drumstick | KFC Original Recipe
21422 Popcorn chicken | KFC
21456 Fried chicken breast | Popeyes, mild
21526 Chicken sandwich | Chick-fil-A
21143 Chicken strips | Chick-fil-A | | chick-n-strips, chicken tenders
21138 French fries | fast food | 1 | fries, chips
21130 Onion rings, fast food | breaded and fried
21229 Chicken nuggets | fast food | 1 | nuggets
21401 Chicken tenders | fast food | 1 | chicken strips, chicken fingers
21469 Fried chicken breast | fast food, with skin and breading | 1
21470 Fried chicken drumstick | fast food, with skin and breading
21471 Fried chicken thigh | fast food, with skin and breading
21472 Fried chicken wing | fast food, with skin and breading
21102 Chicken sandwich, fried | fast food | 1 | crispy chicken sandwich
21490 Chicken sandwich, grilled | fast food
21118 Hot dog with bun | fast food, plain | | hotdog
21120 Corn dog | fast food
21121 Roast beef sandwich | fast food | | arbys
21155 Sub sandwich, turkey | white bread, lettuce, tomato | 1 | subway, submarine, hoagie
21156 Sub sandwich, ham | | | subway, submarine, hoagie
21126 Sub sandwich, tuna | | | subway, submarine, hoagie
21158 Sub sandwich, meatball marinara | | | subway, submarine, hoagie
21160 Sub sandwich, steak and cheese | | | subway, philly cheesesteak
21151 Sub sandwich, chicken teriyaki | sweet onion | | subway, submarine, hoagie
21124 Sub sandwich, cold cut | | | subway, italian sub, hoagie
21153 Sub sandwich, club | turkey, roast beef and ham | | subway, submarine, hoagie
21162 BLT sandwich | sub, white bread | | blt
21061 Burrito, bean and cheese | fast food
21064 Burrito, beef, bean and cheese | fast food | 1
21082 Taco, hard shell | beef, cheese, lettuce | 1
21486 Taco, soft | beef, cheese, lettuce
21487 Taco, soft, chicken | lettuce, cheese
21078 Nachos with cheese | fast food
21080 Nachos supreme | cheese, beans, beef, tomatoes | | loaded nachos
21083 Taco salad | fast food
21488 Chicken quesadilla | fast food | 1 | quesadilla
21519 Breakfast burrito | egg, cheese and sausage
21517 Chicken wrap, crispy | lettuce, cheese, ranch | | snack wrap
21518 Chicken wrap, grilled | lettuce, cheese, ranch | | snack wrap
21127 Coleslaw | fast food | | cole slaw
21129 Hush puppies
21024 French toast sticks
21520 Garlic breadstick | with parmesan
21028 Ice cream cone, soft serve | light vanilla | | soft serve cone
21521 Fruit smoothie | strawberry banana, with low-fat yogurt | | smoothie
21463 Yogurt parfait | with fruit and granola
21379 Side salad | McDonald's, no dressing | | garden salad, green salad, salad
21005 Biscuit with egg and sausage | fast food | | breakfast sandwich
21007 Biscuit with egg, cheese and bacon | fast food | | breakfast sandwich
21009 Sausage biscuit | fast food
21012 Croissant with egg, cheese and bacon | fast food | | breakfast sandwich
21105 Fish sandwich | fast food, with tartar sauce
21119 Chili dog | fast food | | hot dog with chili
21139 Mashed potatoes, fast food
21234 Quarter Pounder | McDonald's, no cheese | | burger
21254 Double Whopper | Burger King | | burger
21262 Soft taco, chicken | Taco Bell
21294 Pizza, cheese, pan | Pizza Hut 14" pan crust
21300 Pizza, cheese, thick crust | 14" chain pizza
21485 Pizza, pepperoni, thin crust | 14" chain pizza
21327 Bacon, Egg & Cheese McGriddles | McDonald's | | mcgriddle
21336 Hot fudge sundae | McDonald's | | sundae
21340 Sausage burrito | McDonald's | | breakfast burrito
21345 Double Quarter Pounder with Cheese | McDonald's | | burger
21358 Sausage McMuffin | McDonald's
21360 Bacon, Egg & Cheese Biscuit | McDonald's
21402 Grilled chicken sandwich | McDonald's Premium Classic
21403 Crispy chicken sandwich | McDonald's Premium Classic
21383 Croissan'wich | Burger King, sausage, egg and cheese | | breakfast sandwich
21415 Biscuit | Popeyes
21419 Biscuit | KFC
21420 Coleslaw | KFC | | cole slaw
21421 Chicken strips | KFC Crispy | | chicken tenders
21436 Fried chicken thigh | KFC Original Recipe
21437 Fried chicken wing | KFC Original Recipe
21438 Fried chicken breast | KFC Extra Crispy
21458 Fried chicken thigh | Popeyes, mild
21417 Chicken strips | Popeyes, mild | | chicken tenders
21464 Fried chicken breast, skin removed | fast food, meat only
21527 Roast beef sandwich | Arby's classic

# ---------------------------------------------------------------- meals and entrees (2200)
22960 Mac and cheese | boxed, prepared | 2 | macaroni and cheese, mac n cheese, kraft dinner, macaroni cheese
22931 SpaghettiOs | canned
22900 Ravioli, beef | canned, in meat sauce | | chef boyardee
22901 Tortellini, cheese | fresh, uncooked
22905 Beef stew | canned
22906 Chicken pot pie | frozen, baked | | pot pie
22908 Corned beef hash | canned
22977 Lasagna with meat sauce, frozen | baked | | lasagne
22910 Cheese lasagna, frozen | baked | | lasagne
22917 Frozen burrito | beef and bean
22958 Chicken rice bowl | frozen meal | | teriyaki bowl
22957 Turkey dinner, frozen | with stuffing, mashed potatoes and gravy | | tv dinner
22537 Hot Pockets, ham and cheese
22972 Pulled pork | in barbecue sauce | | bbq pulled pork
22975 Chicken nuggets, frozen | white meat, precooked | | nuggets
22978 Chicken tenders, frozen | breaded, prepared | | chicken strips, chicken fingers
32006 Taquitos | chicken and cheese, frozen
32012 Pizza rolls | frozen | | totinos
32013 Potstickers | pork and vegetable, frozen | | dumplings, gyoza
32025 Pierogies | potato or cheese, frozen | | pierogi, dumplings
32031 Salisbury steak | with gravy, frozen
22999 Rice pilaf mix, chicken | prepared | | rice-a-roni
22401 Spaghetti with meat sauce, frozen | frozen meal
22918 Frozen burrito, bean and cheese
22955 Egg roll, vegetable | frozen, prepared | | spring roll
22956 Vegetable lasagna, frozen | baked | | lasagne
22959 Mac and cheese, dry mix | boxed, uncooked | | macaroni and cheese, kraft dinner
22970 Mac and cheese, frozen | frozen meal | | macaroni and cheese
22973 Corn dogs, frozen | prepared | | corn dog
32005 Shells and cheese | box mix with cheese sauce, prepared | | velveeta shells, mac and cheese

# ---------------------------------------------------------------- snacks (2500)
19411 Potato chips | | 1 | crisps
19042 Potato chips, BBQ | | | crisps, barbecue chips
19043 Potato chips, sour cream and onion | | | crisps
19422 Potato chips, reduced fat | | | crisps
42283 Potato chips, baked | | | crisps
19410 Stackable potato crisps | | | pringles
19056 Tortilla chips | | 1 | nachos chips
19057 Tortilla chips, nacho cheese | | | doritos
43566 Tortilla chips, baked
19003 Corn chips | | | fritos
19008 Cheese puffs | | | cheetos, cheese curls
19034 Popcorn, air-popped | | 1
25026 Popcorn, microwave | butter flavor
25000 Popcorn, microwave, light | 94% fat free
19807 Popcorn, oil-popped | salted
19039 Caramel popcorn | | | caramel corn
19047 Pretzels | hard, salted
43109 Soft pretzel
19051 Rice cakes | brown rice
19059 Trail mix
19062 Trail mix with chocolate
19033 Chex Mix
19041 Pork rinds | | | pork skins, chicharrones
19400 Banana chips
25013 SunChips | multigrain, original
25037 Pita chips
25040 Veggie chips
25027 Plantain chips
25025 Soy crisps
19404 Granola bar, chewy | chocolate chip | 1
19015 Granola bar, crunchy | plain | | nature valley
19438 Rice Krispies Treat | | | rice krispie treat
19441 Nutri-Grain bar | fruit-filled cereal bar
25051 Clif Bar | energy bar | 1 | protein bar
25017 PowerBar | chocolate | | energy bar, protein bar
25031 Zone Perfect bar | protein bar
25068 Balance bar | protein bar, original
25015 Snickers Marathon protein bar | caramel nut
25021 Luna bar | Nutz Over Chocolate | | protein bar
25067 South Beach protein bar
19407 Beef stick | smoked | | slim jim, meat stick
19009 Corn nuts | | | cornnuts
19021 Granola bar, chewy, peanut butter
19048 Chocolate-covered pretzels
19058 Tortilla chips, ranch | | | cool ranch doritos
25012 Sweet potato chips
25032 Kashi GoLean chewy bar | | | protein bar
25046 Bagel chips
25053 Nature Valley Sweet & Salty bar | peanut | | granola bar
25066 Wasabi peas | roasted
25071 Rice crackers

# ---------------------------------------------------------------- restaurant dishes (3600, 3500)
36602 Fried rice | Chinese restaurant, no meat | 1
36618 General Tso's chicken | Chinese restaurant
36629 Orange chicken | Chinese restaurant
36621 Sweet and sour chicken | Chinese restaurant
36622 Sweet and sour pork | Chinese restaurant
36619 Kung pao chicken | Chinese restaurant
36633 Sesame chicken | Chinese restaurant
36623 Chicken chow mein | Chinese restaurant
36625 Vegetable lo mein | Chinese restaurant | | lo mein
36626 Chicken and vegetables | Chinese restaurant | | chicken stir fry
36603 Beef and vegetables | Chinese restaurant | | beef and broccoli, beef stir fry
36620 Shrimp and vegetables | Chinese restaurant | | shrimp stir fry
36601 Egg roll | Chinese restaurant | | spring roll
36630 Spaghetti with meat sauce | restaurant | 1 | spaghetti bolognese
36038 Spaghetti and meatballs | restaurant
36046 Spaghetti with marinara | restaurant | | spaghetti pomodoro
36041 Lasagna with meat | restaurant | | lasagne
36055 Cheese ravioli with marinara | restaurant
36059 Chicken parmesan | restaurant, without pasta | | chicken parm, chicken parmigiana
36050 Cheese enchilada | restaurant | | enchiladas
36052 Cheese quesadilla | restaurant | | quesadilla
36412 Pork tamale | | | tamales
36417 Mexican rice | | | spanish rice
36403 Beef empanada
36405 Rice and black beans | | | arroz con frijoles
36401 Chicken and rice | | | arroz con pollo
36409 Pupusa, cheese
36415 Arepa
36012 Mozzarella sticks | fried | | fried mozzarella, cheese sticks
36033 Fried fish fillet | battered or breaded | | fish and chips, fried fish
35142 Frybread | Navajo, made with lard | @grain | fry bread
36013 Sirloin steak | restaurant, family style
36014 French fries | restaurant, family style | | chips
36015 Chicken fingers | kids' menu, family style restaurant | | chicken tenders, chicken strips
36016 Fried shrimp | restaurant, breaded
36017 Mac and cheese | kids' menu, family style restaurant | | macaroni and cheese
36036 Onion rings | restaurant, family style
36037 Chili with meat and beans | restaurant | | chili con carne
36039 Hash browns | restaurant, family style
36617 Lemon chicken | Chinese restaurant
36056 Cheese tamales | Mexican restaurant | | tamale
36411 Corn tamale | Latino restaurant | | tamale
`;

// SR28 food group -> the app's category.
const GROUP_CAT = {
  '0100': 'dairy', '0200': 'other', '0400': 'fat', '0500': 'protein', '0600': 'sauce', '0700': 'protein',
  '0800': 'grain', '0900': 'fruit', '1000': 'protein', '1100': 'veg', '1200': 'nut', '1300': 'protein',
  '1400': 'drink', '1500': 'protein', '1600': 'legume', '1700': 'protein', '1800': 'grain',
  '1900': 'snack', '2000': 'grain', '2100': 'dish', '2200': 'dish', '2500': 'snack', '3500': 'dish',
  '3600': 'dish',
};
// Groups that mix kinds of food: [group, pattern on SR28's long description, category]. First match wins.
const CAT_RULES = [
  ['0100', /^Egg[, ]/, 'protein'],
  ['0100', /^(Butter|Ghee)/, 'fat'],
  ['0100', /^Dulce/, 'sauce'],
  ['0100', /^(Ice cream|Frozen novelties)/, 'snack'],
  ['0100', /^(Milk shakes|Eggnog|Beverage)|hot cocoa/, 'drink'],
  ['0100', /Protein supplement/, 'protein'],
  ['0200', /^(Mustard|Vinegar|Capers|Horseradish)/, 'sauce'],
  ['0400', /(Salad dressing|Mayonnaise|dressing)/i, 'sauce'],
  ['0600', /^Soup|Split pea/, 'dish'],
  ['0900', /^Olives/, 'veg'],
  ['0900', /^(Lemon|Lime) juice/, 'fruit'],
  ['0900', /^[^,]*\b(juice|nectar)\b/i, 'drink'],
  ['1100', /french fr|Hash brown|potato puffs|Potato salad|pancakes|Onion rings|Sweet potato fries/i, 'dish'],
  ['1100', /^(Catsup|Pickle relish|Yeast extract)/, 'sauce'],
  ['1100', /^(Tomato juice|Vegetable juice|Carrot juice)/, 'drink'],
  ['1400', /protein powder|whey protein/i, 'protein'],
  ['1400', /Chocolate syrup/i, 'sauce'],
  ['1500', /tuna salad/i, 'dish'],
  ['1600', /^(MORI-NU, )?(Tofu|Tempeh|Natto|Soy protein|Veggie burgers)|meatless/i, 'protein'],
  ['1600', /^Peanut/, 'nut'],
  ['1600', /Soymilk|Soy milk/i, 'drink'],
  ['1600', /Soy sauce|Miso/i, 'sauce'],
  ['1600', /^(Chili|Falafel)/, 'dish'],
  ['1600', /Noodles|flour/i, 'grain'],
  ['1800', /Banana bread|^Cake|Cheesecake|Coffeecake|^Cookie|Cream puff|Danish|Doughnut|Brownie|^Pie|Sweet rolls|Toaster pastr|Eclair|Snack cake|Muffins, blueberry|Ice cream cones|Strudel/i, 'snack'],
  ['1800', /^Crackers, (cheese|flavored|standard snack)|RITZ|^Crackers, wheat/, 'snack'],
  ['1800', /Bread stuffing/, 'dish'],
  ['1900', /^(Honey|Jams|Jellies|Marmalade|Syrups|Molasses|Toppings|Chocolate-flavored hazelnut spread|Sweetener, syrup)/, 'sauce'],
  ['1900', /^(Sugars|Sweeteners?)[, ]/, 'other'],
  ['1900', /^(Cocoa, dry|Gelatins, dry|Baking chocolate)/, 'other'],
  ['2100', /McFLURRY|FROSTY|Ice cream|sundae|apple pie/i, 'snack'],
  ['2100', /smoothie/i, 'drink'],
  ['2500', /jerky|beef sticks/i, 'protein'],
];

// Portion labels that the general tidying (cleanLabel) gets wrong, per food: [tidied SR28 label,
// better label or null to drop it]. Drops are labels that don't fit the food (a skin-on drumstick
// weight on a meat-only drumstick, a hamburger roll on dinner rolls) or would mislead.
const PORTION_FIX = {
  '01038': [['5 package (5 oz)', '1 package (5 oz)']],
  '01067': [['1 container, individual', '1 individual container']],
  '01238': [['1 serving', '1 sandwich']],
  '01240': [['1 unit', '1 cone']],
  '01275': [['5.3 oz', '1 container (5.3 oz)']],
  '01278': [['5.3 oz', '1 container (5.3 oz)']],
  '01280': [['5.3 oz', '1 container (5.3 oz)']],
  '01281': [['5.3 oz', '1 container (5.3 oz)']],
  '04679': [['1 spray, , about 1/3 second', '1 spray (1/3 second)']],
  '05062': [['1 piece', '1 breast']],
  '05066': [['1 drumstick', null]],
  '05069': [['1 drumstick, without skin', null]],
  '05073': [['1 drumstick, with skin', null], ['1 drumstick, without skin', '1 drumstick']],
  '05094': [['1 thigh, without skin', null]],
  '05096': [['1 thigh, without skin', '1 thigh']],
  '05098': [['1 thigh, with skin', null], ['1 thigh, without skin', '1 thigh']],
  '05100': [['1 piece', null]],
  '05103': [['1 piece', null]],
  '05149': [['1/2 goose', null]],
  '05662': [['1 patty (cooked from 4 oz raw)', null]],
  '05668': [['1 patty (cooked from 4 oz raw)', null]],
  '05747': [['1 piece', '1 breast']],
  '06583': [['1 package, without flavor packet', '1 package, noodles only'], ['1 packet', '1 flavor packet']],
  '07011': [['0.99 oz', '1 serving']],
  '07029': [['56 grams', '1 serving']],
  '07057': [['1 piece', '1 slice']],
  '07919': [['2 oz, 2 links', '2 links']],
  '07938': [['1.94 oz', '1 serving (1.94 oz)']],
  '07970': [['1 link', '1 link (14 oz)']],
  '07973': [['1 raw pr g', null]],
  '08065': [['1.25 cup', '1 1/4 cups']],
  '11246': [['1 cup', null]],
  '11399': [['10 crispy crowns', null]],
  '14416': [['1 can, can 12 fl oz', '1 can (12 fl oz)']],
  '14475': [['8 bottle, 8 fl oz', '8 fl oz']],
  '14531': [['1 portion', '1 cocktail']],
  '14627': [['1 serving', '8 fl oz']],
  '15172': [['1 unit, 2 large or 5 small', '2 large or 5 small']],
  '16147': [['1 pattie', '1 patty']],
  '17237': [['1 steak', '1 chop']],
  '18029': [['1 slice', null]],
  '18086': [['1 cake', null]],
  '18120': [['1/6 loaf, 1/6 of the loaf', '1/6 loaf'], ['1 piece, individually wrapped cake', '1 individual cake']],
  '18159': [['1 cookie, pepperidge farm chocolate chunk pecan', null]],
  '18170': [['1 figaroo (2 square halves)', '1 bar']],
  '18231': [['1 cracker, sandwich', '1 sandwich cracker']],
  '18235': [['6 crackers, triscuits, regular size', '6 crackers']],
  '18249': [['1 donettes', '1 mini donut']],
  '18255': [['1 doughnut, hole', '1 donut hole']],
  '18342': [['1 each', null]],
  '18348': [['1 roll', null]],
  '18350': [['1 roll', '1 bun']],
  '18360': [['1 taco', null]],
  '18363': [['1 enchilada', '1 small tortilla']],
  '19109': [['1 bar, miniature (.35 oz)', '1 bar, miniature (0.35 oz)']],
  '19123': [['1/2 cup, from 19211', '1/2 cup']],
  '19140': [['1 singles bag', '1 bag'], ['1 package, fun size', '1 fun size']],
  '19150': [['1 package, 0.6 oz 1 cup', '1 cup (0.6 oz)'], ['1 package, 1.6 oz 2 cups', '2 cups (1.6 oz)']],
  '19152': [['1 package, 1 package', '1 package']],
  '19160': [['1 package (2 oz)', null], ['1 package (2.06 oz, 2 bars)', '1 package (2 bars)']],
  '19173': [['1 serving', null]],
  '19254': [['1 bar (1.30 oz)', '1 bar (1.3 oz)']],
  '19438': [['1 serving', '1 bar']],
  '20029': [['1 cup, dry', null], ['1 cup, cooked', '1 cup']],
  '20094': [['2 oz', 'cooked from 2 oz fresh']],
  '21005': [['1 item', '1 biscuit']],
  '21007': [['1 item', '1 biscuit']],
  '21009': [['1 item', '1 biscuit']],
  '21012': [['1 item', '1 croissant']],
  '21028': [['1 item', '1 cone']],
  '21083': [['1.5 cup', '1 1/2 cups']],
  '21090': [['1 item', '1 burger']],
  '21108': [['1 sandwich', '1 burger']],
  '21113': [['1 sandwich', '1 burger']],
  '21118': [['1 sandwich', '1 hot dog']],
  '21119': [['1 sandwich', '1 chili dog']],
  '21120': [['1 sandwich', '1 corn dog']],
  '21228': [['1 sandwich', '1 burger']],
  '21233': [['1 item (4 oz)', '1 burger']],
  '21234': [['1 item', '1 burger']],
  '21235': [['1 item (7.1 oz)', '1 burger']],
  '21237': [['1 item (7.6 oz)', '1 burger']],
  '21252': [['1 item', '1 burger']],
  '21253': [['1 item', '1 burger']],
  '21254': [['1 item', '1 burger']],
  '21324': [['2.7 oz', '1 pie (2.7 oz)']],
  '21327': [['1 item (5.8 oz)', '1 sandwich']],
  '21336': [['1 item (6.3 oz)', '1 sundae']],
  '21344': [['1 sandwich', '1 burger']],
  '21345': [['1 item', '1 burger']],
  '21358': [['1 item (4 oz)', '1 sandwich']],
  '21359': [['1 item (5.8 oz)', '1 sandwich']],
  '21360': [['1 item (4.9 oz)', '1 biscuit']],
  '21379': [['1 item (3.1 oz)', '1 salad']],
  '21395': [['1 sandwich', '1 burger']],
  '21398': [['1 item', '1 burger']],
  '21402': [['1 item (7 oz)', '1 sandwich']],
  '21403': [['1 item', '1 sandwich']],
  '21463': [['1 item', '1 parfait']],
  '21510': [['1 sandwich', '1 burger']],
  '21517': [['1 item', '1 wrap']],
  '21518': [['1 item', '1 wrap']],
  '23565': [['1 portion', 'cooked from 1/2 lb raw']],
  '28313': [['1 roll', '1 bun']],
  '28322': [['1 piece, bagel', '1 bagel']],
  '28399': [['1 arrowroot biscuit', null]],
  '32025': [['3 pieces, pierogies', '3 pierogies']],
  '43158': [['1 packet sugar twin', null]],
  '43367': [['1 oz, with bone, cooked', null]],
};
// Gaps filled from another SR28 entry for the same thing, where ABBREV.txt's two weights are only
// cups and spoons: a hard-boiled egg is the large egg SR28 weighs at 50 g raw (01123), and a slice of
// cheddar weighs what SR28's sliced cheddar does (01270).
const PORTION_BORROW = { '01009': ['01270', '1 slice (3/4 oz)'], '01129': ['01123', '1 large'] };

// Foods whose names share no word with SR28's description on purpose.
const NAME_CHECK_OK = new Set([]);

// Extra spellings and names, added wherever the word appears in a food's name.
const ALT_WORDS = { yogurt: 'yoghurt', zucchini: 'courgette', eggplant: 'aubergine', cilantro: 'coriander', shrimp: 'prawns' };
// What a food is, for foods whose names don't say it ("Cheerios", "Queso fresco").
const AUTO_ALIASES = [[/^Cereals ready-to-eat/, 'cereal'], [/^Cheese, /, 'cheese']];

const CATS = ['fruit', 'veg', 'grain', 'legume', 'nut', 'protein', 'dairy', 'fat', 'sauce', 'snack', 'drink', 'dish', 'other'];
const CAT_LABELS = {
  fruit: 'Fruit', veg: 'Vegetables', grain: 'Grains, bread & cereal', legume: 'Beans & lentils', nut: 'Nuts & seeds',
  protein: 'Protein', dairy: 'Dairy', fat: 'Oils & fats', sauce: 'Sauces & spreads', snack: 'Snacks & sweets',
  drink: 'Drinks', dish: 'Meals & fast food', other: 'Spices & baking',
};

/* ---------------------------------------------------------------- SR28 files */
function readSr(file) {
  let text;
  try { text = readFileSync(join(SR, file), 'latin1'); }
  catch { throw new Error(`Missing ${file}: run npm install (fda-nutrient-database ships SR28's files)`); }
  // "~"-quoted text fields, "^"-separated.
  return text.split(/\r?\n/).filter(Boolean).map((line) => line.split('^').map((f) => f.replace(/^~|~$/g, '')));
}
const abbrev = new Map(readSr('ABBREV.txt').map((r) => [r[0], r]));
const foodDes = new Map(readSr('FOOD_DES.txt').map((r) => [r[0], r]));
// ABBREV.txt columns used here.
const A = { kcal: 3, protein: 4, fat: 5, carbs: 7, fiber: 8, gm1: 48, desc1: 49, gm2: 50, desc2: 51 };

/* ---------------------------------------------------------------- helpers */
const round1 = (x) => Math.round(Number(x) * 10 + 1e-7) / 10;
const words = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['\u2019]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
// Same plural folding as the app's search.
function stem(w) {
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 2 && w.endsWith('y')) w = w.slice(0, -1) + 'i';
  return w;
}

const FRACTIONS = { '.5': '1/2', '.25': '1/4', '.33': '1/3', '.333': '1/3', '.67': '2/3', '.667': '2/3', '.666': '2/3', '.75': '3/4', '.2': '1/5', '.167': '1/6', '.125': '1/8', '.083': '1/12', '.1': '1/10' };
// SR28's household-weight labels made short: ".5 cup, (1 NLEA serving)" -> "1/2 cup",
// "1 serving, 2.13 oz bar" -> "1 bar (2.13 oz)", "1 potato, large (3" to 4-1/4" dia.)" -> "1 potato, large".
function cleanLabel(raw) {
  let s = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!s || /^1 unit\b.*yield/.test(s)) return null;  // whole-bird yields aren't portions
  s = s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*\([^)]*$/, '');
  // Brackets: keep short amounts like "(1.5 oz)" or "(22 whole kernels)", drop sizes in inches and notes.
  s = s.replace(/,?\s*\(([^()]*)\)/g, (m, inner) => (/\d/.test(inner) && inner.length <= 20 && !/"| x |serving|yield|per |include|approx|average|mean|nlea/.test(inner) ? ` (${inner})` : ''));
  s = s.replace(/^(\d+) inch, sub$/, '$1-inch sub');
  s = s.replace(/,[^,]*("|\binch\b)[^,]*/g, '').replace(/, [\d\-\/ ]+ in\..*$/, '');
  s = s.replace(/,? ?(edible )?yields?$/, '').replace(/, (as purchased|refrigerated|without refuse|excluding refuse|without skin and seeds?)\b/g, '');
  s = s.replace(/\btablespoons?\b/g, 'tbsp').replace(/\bteaspoons?\b/g, 'tsp').replace(/drained solids/, 'drained')
    .replace(/sweetpotato/, 'sweet potato').replace(/chopped or dice$/, 'chopped or diced');
  // "1 serving, 2 tbsp" -> "2 tbsp", "1 serving, packet" -> "1 packet", "1 roll, 1 serving" -> "1 roll".
  const served = s.match(/^1 (?:nlea )?serving, (.+)$/);
  if (served) s = /varied|per /.test(served[1]) ? '1 serving' : /^[\d.\/]/.test(served[1]) ? served[1] : `1 ${served[1]}`;
  s = s.replace(/^1 serving \((.+)\)$/, '$1').replace(/, (?:1 )?(?:nlea )?serving$/, '').replace(/^1 nlea serving$/, '1 serving');
  s = s.replace(/^\.\d+(?= )/, (d) => FRACTIONS[d] || '0' + d);
  s = s.replace(/^([\d.\/]+) ((?:fl )?oz)\.? (bar|pack|can|pop|cup|pudding cup|bag)$/, '1 $3 ($1 $2)');
  s = s.replace(/^(1 [a-z' ]+?),? ([\d.\/]+) ?((?:fl )?oz)\.?(?: cup)?$/, '$1 ($2 $3)');
  s = s.replace(/^(\d+ [a-z]+), ([\d.]+) ?oz$/, '$1 ($2 oz)');
  s = s.replace(/^1 each, (.+)$/, '1 $1').replace(/^1 individual, /, '1 individual ').replace(/, or /g, ' or ');
  s = s.replace(/, (1\/\d+)(?: of)?(?: the)? (pie|pizza)$/, ' ($1 $2)').replace(/, (\d)\/lb$/, ' ($1 per lb)');
  s = s.replace(/^([2-9]|\d\d+) (cracker|cookie|scoop|strip)$/, '$1 $2s');
  s = s.replace(/\s+/g, ' ').replace(/[ ,]+$/, '').trim();
  return s || null;
}

// Two household weights per food (all ABBREV.txt carries), tidied. Whole roasts, pies, heads of
// lettuce, family packs and "1 piece, cooked" (the yield of 1 lb raw meat) are dropped; 100 g is
// left to the app.
const fixesUsed = new Set();
function portionsOf(ndb, row) {
  const fix = PORTION_FIX[ndb] || [];
  const out = [];
  const raw = [[row[A.gm1], row[A.desc1]], [row[A.gm2], row[A.desc2]]];
  if (PORTION_BORROW[ndb]) {
    const [from, want] = PORTION_BORROW[ndb];
    const src = abbrev.get(from);
    const got = [[src[A.gm1], src[A.desc1]], [src[A.gm2], src[A.desc2]]].filter(([, d]) => cleanLabel(d || '') === want);
    if (!got.length) errors.push(`PORTION_BORROW ${ndb}: ${from} has no "${want}"`);
    raw.unshift(...got);  // first: the portion people reach for
  }
  for (const [g, d] of raw) {
    const grams = Number(g);
    if (!d || !(grams > 0) || grams >= 1000) continue;
    let label = cleanLabel(d);
    const f = fix.find((x) => x[0] === label);
    if (f) { label = f[1]; fixesUsed.add(f); }
    if (!label || /^1 (recipe|quart|gallon|lb|roast|piece, cooked)\b/.test(label)) continue;
    if (grams > 400 && !/fl oz/.test(label) && /^1 (pie|pizza|cake|loaf|bird|head|bunch|package|bag|breast|fruit|steak)\b/.test(label)) continue;
    if (out.some((p) => p[0] === label)) continue;
    out.push([label, grams]);
  }
  // "1 serving" adds nothing next to a named portion of the same weight.
  return out.filter((p) => !(p[0] === '1 serving' && out.some((q) => q !== p && q[1] === p[1])));
}

// Catches a mistyped NDB number: the name (or aliases) must share a word with SR28's description.
const GENERIC = new Set(['raw', 'cooked', 'with', 'without', 'and', 'or', 'in', 'of', 'the', 'a', 'fat', 'low', 'light', 'plain', 'fresh', 'dry', 'dried', 'canned', 'frozen', 'whole', 'regular', 'sweetened', 'unsweetened', 'reduced', 'free', 'style', 'mix', 'prepared']);
function nameMisses(name, extra, sr) {
  const srWords = new Set(words(sr).map(stem));
  const has = (w) => srWords.has(stem(w)) || [...srWords].some((x) => x.length >= 4 && stem(w).length >= 4 && (x.startsWith(stem(w)) || stem(w).startsWith(x)));
  const own = words(name).filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w));
  const missing = own.filter((w) => !has(w));
  const any = own.some(has) || words(extra).filter((w) => !GENERIC.has(w)).some(has);
  return { missing, any };
}

/* ---------------------------------------------------------------- picks */
const foods = [];
const errors = [];
const seen = new Set();
for (const line of PICKS.split('\n')) {
  const text = line.replace(/#.*$/, '').trim();
  if (!text) continue;
  const m = text.match(/^(\d{5})\s+(.*)$/);
  if (!m) { errors.push(`Bad line: ${line}`); continue; }
  const [ndb, rest] = [m[1], m[2]];
  const [name = '', detail = '', flags = '', aliasText = ''] = rest.split('|').map((s) => s.trim());
  const row = abbrev.get(ndb);
  const des = foodDes.get(ndb);
  if (!row || !des) { errors.push(`${ndb} ${name}: not in SR28`); continue; }
  if (seen.has(ndb)) { errors.push(`${ndb} ${name}: listed twice`); continue; }
  seen.add(ndb);
  if (!name) { errors.push(`${ndb}: no name`); continue; }
  const grp = des[1], long = des[2], common = des[4], maker = des[5];
  const pop = Number((flags.match(/\b[0-3]\b/) || ['0'])[0]);
  let cat = (flags.match(/@(\w+)/) || [])[1];
  if (!cat) {
    const rule = CAT_RULES.find(([g, re]) => g === grp && re.test(long));
    cat = rule ? rule[2] : GROUP_CAT[grp];
  }
  if (!CATS.includes(cat)) { errors.push(`${ndb} ${name}: unknown category ${cat}`); continue; }

  // Aliases: the listed ones plus spelling variants and group words, minus any the name already
  // covers. (Words only in the detail stay, as search ranks aliases above the detail.)
  const own = new Set(words(name).map(stem));
  const aliases = [];
  const addAlias = (a) => {
    a = a.trim().toLowerCase();
    if (a && !words(a).every((w) => own.has(stem(w))) && !aliases.includes(a)) aliases.push(a);
  };
  aliasText.split(',').forEach(addAlias);
  for (const w of words(name)) if (ALT_WORDS[w]) addAlias(ALT_WORDS[w]);
  for (const [re, a] of AUTO_ALIASES) if (re.test(long)) addAlias(a);

  const check = nameMisses(name, `${detail} ${aliases.join(' ')}`, `${long} ${common} ${maker}`);
  if (!check.any && !NAME_CHECK_OK.has(ndb)) errors.push(`${ndb} "${name}" shares no word with SR28's "${long}"`);

  const fiber = row[A.fiber] === '' ? null : round1(row[A.fiber]);
  foods.push({
    id: Number(ndb), ndb, name, detail, cat, pop, aliases, long, grp, missing: check.missing,
    kcal: Number(row[A.kcal]), p: round1(row[A.protein]), c: round1(row[A.carbs]), f: round1(row[A.fat]), fib: fiber,
    portions: portionsOf(ndb, row), raw: [[row[A.gm1], row[A.desc1]], [row[A.gm2], row[A.desc2]]],
  });
}

/* ---------------------------------------------------------------- checks */
const keys = new Map();
for (const f of foods) {
  const key = `${f.name}|${f.detail}`.toLowerCase();
  if (keys.has(key)) errors.push(`Same name and detail: ${f.ndb} and ${keys.get(key)} (${f.name})`);
  keys.set(key, f.ndb);
  for (const s of [f.name, f.detail, ...f.aliases, ...f.portions.map((p) => p[0])]) {
    if (/[\n\\`]/.test(s)) errors.push(`${f.ndb}: unsafe text ${JSON.stringify(s)}`);
  }
  for (const k of ['kcal', 'p', 'c', 'f']) if (!Number.isFinite(f[k]) || f[k] < 0) errors.push(`${f.ndb}: bad ${k}`);
}
if (foods.length < 1300 || foods.length > 1700) errors.push(`${foods.length} foods; aim for 1,300-1,700`);
// A fix that no longer matches means SR28's label, the tidying or the pick changed: review it.
for (const [ndb, list] of Object.entries(PORTION_FIX)) {
  for (const x of list) if (!fixesUsed.has(x)) errors.push(`PORTION_FIX ${ndb}: no portion "${x[0]}"`);
}

/* ---------------------------------------------------------------- output */
const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const order = (f) => CATS.indexOf(f.cat);
foods.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name) || a.id - b.id);
// Short rows; aliases and popularity are left off when empty.
const rows = foods.map((f) => {
  const r = [f.id, q(f.name), q(f.detail), q(f.cat), f.kcal, f.p, f.c, f.f, f.fib === null ? 'null' : f.fib,
    `[${f.portions.map(([l, g]) => `[${q(l)},${g}]`).join(',')}]`];
  if (f.aliases.length || f.pop) r.push(q(f.aliases.join(', ')));
  if (f.pop) r.push(f.pop);
  return `    [${r.join(',')}]`;
});

const js = `/* Built-in food list for calorie and macro tracking: ${foods.length} common foods, nutrients per 100 g,
 * household portions.
 *
 * Source: USDA National Nutrient Database for Standard Reference, Release 28 (SR28), public domain.
 * Generated by scripts/build-foods.mjs from SR28's ABBREV.txt and FOOD_DES.txt - edit that script, not
 * this file. Regenerate with: npm install && node scripts/build-foods.mjs
 *
 *   GH.foods.get(id)                 { id, name, detail, cat, kcal, p, c, f, fib, portions } or null
 *                                    id is SR28's NDB number; kcal, protein, carbs, fat and fiber are
 *                                    per 100 g (fib is null where SR28 has no value); portions are
 *                                    [label, grams] pairs, and 100 g always applies on top of them
 *   GH.foods.search(query, { limit }) best matches first (default limit 25)
 *   GH.foods.all(), .count, .categories ({ key: label }, display order), .source
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});

  // Category keys and labels, in display order.
  const CATEGORIES = Object.freeze({
${CATS.map((c) => `    ${c}: ${q(CAT_LABELS[c])},`).join('\n')}
  });

  // [id, name, detail, category, kcal, protein, carbs, fat, fiber, portions, aliases, popularity 0-3]
  const ROWS = [
${rows.join(',\n')},
  ];
${RUNTIME()}
})(typeof window !== 'undefined' ? window : globalThis);
`;

function RUNTIME() {
  return String.raw`
  const items = [];
  const byId = new Map();
  const extra = [];  // search-only: [aliases, popularity] per item
  for (const r of ROWS) {
    const it = Object.freeze({
      id: r[0], name: r[1], detail: r[2], cat: r[3], kcal: r[4], p: r[5], c: r[6], f: r[7], fib: r[8],
      portions: Object.freeze(r[9].map((x) => Object.freeze(x))),
    });
    items.push(it);
    byId.set(it.id, it);
    extra.push([r[10] || '', r[11] || 0]);
  }
  Object.freeze(items);

  /* Search. Every query word has to start a word of the name, detail or aliases; plurals match
   * singulars (egg/eggs, berry/berries) and accents don't matter. Whole words beat prefixes, the
   * name beats aliases beats the detail, earlier words in the name beat later ones, popular foods get
   * a boost, and ties go to the shorter name. The index is built on the first search. */
  const STOP = new Set(['a', 'an', 'and', 'n', 'the', 'of', 'with', 'in', 'on', 'or', 'for']);
  // Lower case, no accents or apostrophes: "Crème brûlée" -> "creme brulee", "M&M's" -> "m&ms".
  function norm(s) {
    s = String(s).toLowerCase();
    if (/[^ -~]/.test(s)) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.replace(/['\u2019]/g, '');
  }
  // Words, plus hyphenated and "&" compounds run together ("hard-boiled" also gives "hardboiled").
  function words(s, compounds) {
    const out = [];
    for (const chunk of norm(s).split(/[^a-z0-9&-]+/)) {
      const parts = chunk.split(/[&-]+/).filter(Boolean);
      out.push(...parts);
      if (compounds && parts.length > 1) out.push(parts.join(''));
    }
    return out;
  }
  function stem(w) {
    if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
    if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
    if (w.length > 2 && w.endsWith('y')) w = w.slice(0, -1) + 'i';
    return w;
  }
  const keyOf = (ws) => ws.filter((w) => !STOP.has(w)).map(stem).join(' ');

  let index = null;
  function buildIndex() {
    index = items.map((it, i) => {
      const e = { w: [], st: [], ex: [], pre: [], key: keyOf(words(it.name)), pop: extra[i][1] };
      const add = (text, exact, prefix, step) => words(text, true).forEach((w, pos) => {
        const pen = step * Math.min(pos, 5);
        e.w.push(w); e.st.push(stem(w)); e.ex.push(exact - pen); e.pre.push(prefix - pen);
      });
      add(it.name, 100, 60, 6);
      add(extra[i][0], 80, 45, 0);
      add(it.detail, 40, 25, 0);
      return e;
    });
  }

  function search(query, opts) {
    const limit = opts && opts.limit > 0 ? opts.limit : 25;
    let toks = words(query == null ? '' : query);
    const kept = toks.filter((t) => !STOP.has(t));
    if (kept.length) toks = kept;
    if (!toks.length) return [];
    if (!index) buildIndex();
    const stems = toks.map(stem);
    const qkey = stems.join(' ');
    const hits = [];
    for (let i = 0; i < index.length; i++) {
      const e = index[i];
      let score = e.pop * 25;
      for (let k = 0; k < toks.length && score >= 0; k++) {
        let best = -1;
        for (let j = 0; j < e.w.length; j++) {
          const s = e.st[j] === stems[k] ? e.ex[j] : e.w[j].startsWith(toks[k]) ? e.pre[j] : -1;
          if (s > best) best = s;
        }
        score = best < 0 ? -1 : score + best;
      }
      if (score < 0) continue;
      if (e.key === qkey) score += 60;
      else if (e.key.startsWith(qkey + ' ')) score += 20;
      hits.push([score, i]);
    }
    hits.sort((a, b) => b[0] - a[0] || items[a[1]].name.length - items[b[1]].name.length || items[a[1]].id - items[b[1]].id);
    return hits.slice(0, limit).map((h) => items[h[1]]);
  }

  GH.foods = {
    count: items.length,
    categories: CATEGORIES,
    get: (id) => byId.get(Number(id)) || null,
    all: () => items,
    search,
  };
  GH.foods.source = 'USDA SR28 (public domain)';`;
}

/* ---------------------------------------------------------------- report */
if (REPORT) {
  for (const c of CATS) {
    console.log(`\n== ${c}`);
    for (const f of foods.filter((x) => x.cat === c)) {
      const raw = f.raw.filter(([, d]) => d).map(([g, d]) => `${d.replace(/\s+/g, ' ')}=${g}`).join('; ');
      console.log(`${f.ndb} ${f.name}${f.detail ? ' / ' + f.detail : ''}${f.pop ? ' *' + f.pop : ''} | ${f.kcal} p${f.p} c${f.c} f${f.f} fib${f.fib} | ${f.portions.map((p) => `${p[0]}=${p[1]}`).join('; ')}${f.aliases.length ? ' | aka ' + f.aliases.join(', ') : ''}\n      SR28: ${f.long}${f.missing.length ? '   [not in SR28 text: ' + f.missing.join(' ') + ']' : ''}\n      raw portions: ${raw}`);
    }
  }
  console.log('\n== no portions:', foods.filter((f) => !f.portions.length).map((f) => f.ndb + ' ' + f.name).join('; '));
  // Energy vs macros: SR28 uses food-specific factors and counts little energy from fiber.
  console.log('\n== kcal vs 4P + 4(C - fiber) + 2 fiber + 9F');
  const alcohol = /beer|wine|liquor|vodka|rum|gin|whiskey|liqueur|daiquiri|pina colada|sake|cider|sour|sunrise|hard lemonade|vanilla extract|merlot|cabernet|pinot|zinfandel|syrah|chardonnay|sauvignon|riesling|budweiser|bud light/i;
  for (const f of foods) {
    if (alcohol.test(`${f.name} ${f.detail}`)) continue;
    const fib = f.fib || 0;
    const exp = 4 * f.p + 4 * Math.max(0, f.c - fib) + 2 * fib + 9 * f.f;
    const d = f.kcal - exp;
    if (Math.abs(d) > Math.max(15, 0.12 * f.kcal)) console.log(`  ${f.ndb} ${f.name}: ${f.kcal} vs ${exp.toFixed(0)} (${d > 0 ? '+' : ''}${d.toFixed(0)}, ${(100 * d / Math.max(1, f.kcal)).toFixed(0)}%)`);
  }
  console.log('\n== duplicate names:', [...new Set(foods.map((f) => f.name).filter((n, i, a) => a.indexOf(n) !== i))].join('; '));
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
writeFileSync(OUT, js);
const counts = CATS.map((c) => `${c} ${foods.filter((f) => f.cat === c).length}`).join(', ');
console.log(`foods.js: ${foods.length} foods (${counts}), ${foods.filter((f) => f.pop).length} popular, ${(Buffer.byteLength(js) / 1024).toFixed(0)} KB`);
