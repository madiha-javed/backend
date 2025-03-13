import express from 'express';
import mysql from 'mysql2';
import cors from 'cors';
import bcrypt from 'bcrypt';

const app = express();
app.use(cors({
    origin: '*'
}))

app.use(express.json());

// db connection
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "12345678",
    database: "recipe_book"
});

// get all users
app.get('/users', function(req,res) {
    db.query("SELECT * FROM users", (error, result, fields) => {
        if (error) {
            res.status(404).json({ errorno: error.errno, message: error.message });
        } else {
            res.status(200).json(result);
        }
    });
});

// get user by id
app.get('/users/:id', function(req,res) {
    // id - route parameter
    let userId=Number(req.params.id);
    db.query(`SELECT * FROM users WHERE user_id=${userId}`, (error, result, fields) => {
        res.status(200).json(result[0]);
    });
});

// delete user
app.delete('/users/:id', function(req,res) {
    let userId=Number(req.params.id);
    // validation
    if (typeof userId !== 'number') {
        res.status(404).json({ message: "Inexistent user" });
    } else {
        // parametrized queries
        db.query(`DELETE FROM users WHERE user_id = ?`, [userId], (error, result, fields) => {
            res.status(200).json({ message: "User deleted" });
        });
    }
});

//insert new user
app.post('/users', async function(req,res) {
    let newUser=req.body;
    let password=newUser.password;
    let hashedPassword = await bcrypt.hash(password, 10);
    let userInfo={
        ...newUser,
        password: hashedPassword
    }
    
    db.query(`INSERT INTO users(first_name, last_name,email,password,birth_date) VALUES(?,?,?,?,?)`, [userInfo.first_name, userInfo.last_name, userInfo.email, userInfo.password, userInfo.birth_date], (error, result, fields) => {
        if (error) {
            console.log(error);
            if (error.errno===1062) {
                // 409 - Conflict
                res.status(409).json({ errorno: error.errno, message: "Repeated e-mail!" });
            } else {
                // res.status(404).json({ message: error.sqlMessage });
                res.status(404).json({ errorno: error.errno, message: error.message });
            }
        } else {
            res.status(200).json({ message: "User created" });
        }
    });
});

//user login
app.post('/login', function(req,res) {
    console.log("test1");
    console.log(req.body);
    let { email, password } = req.body;
    db.query(`SELECT * FROM users WHERE email=?`, [email], async (error, result, fields) => {
        if (result.length===0) {
            console.log("email not found after query");
            res.status(200).json({ found: false });
        } else {
            console.log("email found after query");
            const userPassword=result[0].password;
            console.log("userPassword",userPassword);
            const match = await bcrypt.compare(password,userPassword);
            if (!match) {
                res.status(200).json({ found: false });
                console.log("password not matched");
            } else {
                res.status(200).json({ found: true, data: result[0] }); 
                console.log("password matched");
            }
        }
    });
});

// get recipes for specific user_id
app.get('/recipes/user/:id', function(req,res) {
    console.log(req.params);
    // id - route parameter
    let userId=Number(req.params.id);
    db.query(`SELECT * FROM recipes WHERE user_id=${userId}`, (error, result, fields) => {
        if (error) {
            console.error('Error fetching ingredients:', error);
            res.status(500).json({ message: error.message });
        } else {
            res.status(200).json(result);
        }
    });
});

// add new recipe
// First, modify the ingredients handling in the recipe POST endpoint:
app.post('/recipes', async function(req, res) {
    console.log('Received recipe:', req.body);
    const recipe = req.body;
    
    // Validate required fields
    if (!recipe.title || !recipe.portionSize || !recipe.ingredients || !recipe.cookingSteps) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    try {
        // Get valid user_id first
       // const [users] = await db.promise().query('SELECT user_id FROM users LIMIT 1');
       // const userId = users[0].user_id;

        // Start transaction
        await db.promise().query('START TRANSACTION');
        console.log('Started transaction');

        // 1. Insert main recipe
        const [recipeResult] = await db.promise().query(
            `INSERT INTO recipes (
                title, description, portion_size, cooking_time, 
                prepration_time, steps, notes, ratings, 
                source, category, user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                recipe.title,
                recipe.description || null,
                recipe.portionSize,
                recipe.cookingTime || null,
                recipe.preparationTime || null,
                recipe.cookingSteps,
                recipe.notes || null,
                recipe.rating || null,
                recipe.source || null,
                recipe.category || null,
                recipe.user
            ]
        );
        console.log(recipeResult);

        const recipeId = recipeResult.insertId;
        console.log('Recipe inserted with ID:', recipeId);

        // 2. Handle ingredients
        for (const ing of recipe.ingredients) {
            if (!ing.name || !ing.quantity || !ing.unit) {
                console.log('Skipping incomplete ingredient:', ing);
                continue;
            }

            console.log('Processing ingredient:', ing.name);
            
            // Use LOWER() for case-insensitive search
            const [existingIngredients] = await db.promise().query(
                'SELECT ingredients_id FROM ingredients WHERE LOWER(name) = LOWER(?)',
                [ing.name.trim()]
            );
            
            console.log('Existing ingredients check result:', existingIngredients);

            let ingredientId;
            if (existingIngredients.length === 0) {
                // Insert new ingredient
                console.log('Inserting new ingredient:', ing.name);
                
                const [newIngredient] = await db.promise().query(
                    'INSERT INTO ingredients (name) VALUES (?)',
                    [ing.name.trim()]
                );
                
                ingredientId = newIngredient.insertId;
                console.log('New ingredient ID:', ingredientId);
            } else {
                ingredientId = existingIngredients[0].ingredients_id;
                console.log('Using existing ingredient with ID:', ingredientId);
            }

            // Insert recipe-ingredient relationship
            await db.promise().query(
                `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) 
                 VALUES (?, ?, ?, ?)`,
                [recipeId, ingredientId, ing.quantity, ing.unit]
            );
            console.log('Added ingredient relationship for:', ing.name);
        }

       // Verify ingredients were added
        const [ingredientsCheck] = await db.promise().query(
            'SELECT i.name FROM ingredients i JOIN recipe_ingredients ri ON i.ingredients_id = ri.ingredient_id WHERE ri.recipe_id = ?',
            [recipeId]
        );
        console.log('Recipe ingredients after insert:', ingredientsCheck);

        await db.promise().query('COMMIT');
        console.log('Transaction committed successfully');
        
        res.status(201).json({ 
            message: "Recipe created successfully", 
            recipeId: recipeId,
            ingredients: ingredientsCheck
        });
    } catch (error) {
        console.error('Error in recipe creation with details:', error);
        await db.promise().query('ROLLBACK');
        res.status(500).json({ 
            message: "Error creating recipe", 
            error: error.message,
            stack: error.stack
        });
    }
});


// Get all recipes
app.get('/recipes', function(req, res) {
    db.query("SELECT * FROM recipes", (error, result) => {
        if (error) {
            console.error('Error fetching recipes:', error);
            res.status(500).json({ message: error.message });
        } else {
            res.status(200).json(result);
        }
    });
});

// Get all ingredients
app.get('/ingredients', function(req, res) {
    db.query("SELECT * FROM ingredients", (error, result) => {
        if (error) {
            console.error('Error fetching ingredients:', error);
            res.status(500).json({ message: error.message });
        } else {
            res.status(200).json(result);
        }
    });
});

// Get all tags
app.get('/tags', function(req, res) {
    db.query("SELECT * FROM tags", (error, result) => {
        if (error) {
            console.error('Error fetching tags:', error);
            res.status(500).json({ message: error.message });
        } else {
            res.status(200).json(result);
        }
    });
});

// Get recipe by ID with ingredients
app.get('/recipes/:id', async function(req, res) {
    const recipeId = Number(req.params.id);
    try {
        // Get recipe details
        const [recipe] = await db.promise().query(
            `SELECT * FROM recipes WHERE recipe_id = ?`,
            [recipeId]
        );

        if (recipe.length === 0) {
            return res.status(404).json({ message: "Recipe not found" });
        }

        // Get recipe ingredients
        const [ingredients] = await db.promise().query(
            `SELECT i.name, ri.quantity, ri.unit 
             FROM recipe_ingredients ri 
             JOIN ingredients i ON ri.ingredient_id = i.ingredients_id 
             WHERE ri.recipe_id = ?`,
            [recipeId]
        );

        const recipeData = {
            ...recipe[0],
            ingredients: ingredients
        };

        res.status(200).json(recipeData);
    } catch (error) {
        console.error('Error fetching recipe:', error);
        res.status(500).json({ message: error.message });
    }
});

// Update recipe
app.put('/recipes/:id', async function(req, res) {
    const recipeId = Number(req.params.id);
    const recipe = req.body;

    try {
        await db.promise().query('START TRANSACTION');

        // 1. Update main recipe
        await db.promise().query(
            `UPDATE recipes SET 
                title = ?, 
                description = ?, 
                portion_size = ?, 
                cooking_time = ?, 
                prepration_time = ?, 
                steps = ?,
                notes = ?, 
                ratings = ?,
                source = ?, 
                category = ?
            WHERE recipe_id = ?`,
            [
                recipe.title,
                recipe.description || null,
                recipe.portionSize,
                recipe.cookingTime || null,
                recipe.preparationTime || null,
                recipe.cookingSteps,
                recipe.notes || null,
                recipe.rating || null,
                recipe.source || null,
                recipe.category || null,
                recipeId
            ]
        );

        // 2. Delete existing ingredients
        await db.promise().query(
            'DELETE FROM recipe_ingredients WHERE recipe_id = ?',
            [recipeId]
        );

        // 3. Add new ingredients
        for (const ing of recipe.ingredients) {
            if (!ing.name || !ing.quantity || !ing.unit) continue;

            // Check if ingredient exists
            const [existingIngredients] = await db.promise().query(
                'SELECT ingredients_id FROM ingredients WHERE LOWER(name) = LOWER(?)',
                [ing.name.trim()]
            );

            let ingredientId;
            if (existingIngredients.length === 0) {
                // Insert new ingredient
                const [newIngredient] = await db.promise().query(
                    'INSERT INTO ingredients (name) VALUES (?)',
                    [ing.name.trim()]
                );
                ingredientId = newIngredient.insertId;
            } else {
                ingredientId = existingIngredients[0].ingredients_id;
            }

            // Insert recipe-ingredient relationship
            await db.promise().query(
                `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) 
                 VALUES (?, ?, ?, ?)`,
                [recipeId, ingredientId, ing.quantity, ing.unit]
            );
        }

        await db.promise().query('COMMIT');
        res.status(200).json({ message: "Recipe updated successfully" });
    } catch (error) {
        await db.promise().query('ROLLBACK');
        console.error('Error updating recipe:', error);
        res.status(500).json({ message: error.message });
    }
});

// Delete recipe and its ingredients
app.delete('/recipes/:id', async function(req, res) {
    const recipeId = Number(req.params.id);
    
    try {
        await db.promise().query('START TRANSACTION');

        // First delete from recipe_ingredients (due to foreign key constraint)
        await db.promise().query(
            'DELETE FROM recipe_ingredients WHERE recipe_id = ?',
            [recipeId]
        );

        // Then delete the recipe
        await db.promise().query(
            'DELETE FROM recipes WHERE recipe_id = ?',
            [recipeId]
        );

        await db.promise().query('COMMIT');
        res.status(200).json({ message: "Recipe deleted successfully" });
    } catch (error) {
        await db.promise().query('ROLLBACK');
        console.error('Error deleting recipe:', error);
        res.status(500).json({ message: error.message });
    }
});


// Get weekly planner data
app.get('/planner/user/:id', function(req, res) {
    console.log("start");
    console.log(req.params);
    let userId=Number(req.params.id);
    db.query(`SELECT * FROM weekly_planner, recipes WHERE weekly_planner.recipe_id=recipes.recipe_id AND recipes.user_id=${userId}`, (error, result) => {
        if (error) {
            console.error('Error fetching planner:', error);
            res.status(500).json({ message: error.message });
        } else {
            console.log("success");
            console.log(result);
            res.status(200).json(result);
        }
    });
});

//post planner data
app.post('/planner', async function(req, res) {
    const plan = req.body;
    
    try {
        // First check if recipe exists
        const [recipeExists] = await db.promise().query(
            'SELECT recipe_id FROM recipes WHERE recipe_id = ?',
            [plan.recipe_id]
        );

        if (recipeExists.length === 0) {
            return res.status(404).json({ 
                message: "Recipe not found. Cannot add non-existent recipe to planner." 
            });
        }

        // If recipe exists, proceed with insertion
        const [result] = await db.promise().query(
            `INSERT INTO weekly_planner(recipe_id, date, meal_time) 
             VALUES (?, ?, ?)`,
            [plan.recipe_id, plan.date, plan.meal_time]
        );

        res.status(201).json({ 
            message: "Plan entry created successfully",
            plannerId: result.insertId
        });

    } catch (error) {
        console.error('Error inserting planner:', error);
        res.status(500).json({ 
            message: "Failed to create plan entry",
            error: error.message 
        });
    }
});

// error route
app.use((req, res, next) => {
    res.status(404).send('Wrong route!');
});

app.listen(3000, () => {
    console.log(`Listening on http://localhost:3000`);
})