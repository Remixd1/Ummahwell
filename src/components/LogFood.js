import React, { useState } from 'react';
import './LogFood.css';
import { db } from './firebase';
import { getAuth } from 'firebase/auth';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const LogFood = ({ addFoodToDiary }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [foods, setFoods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedFood, setSelectedFood] = useState(null); // State for popup
  const [servingSize, setServingSize] = useState("1"); // Store as string

  const mapOffProductToFood = (product) => {
    const caloriesServing = product.nutriments?.["energy-kcal_serving"];
    const calories100g = product.nutriments?.["energy-kcal_100g"];
    const calories = caloriesServing || calories100g || 0;
    const proteins = product.nutriments?.proteins_serving || product.nutriments?.proteins_100g || 0;
    const fat = product.nutriments?.fat_serving || product.nutriments?.fat_100g || 0;
    const carbs = product.nutriments?.carbohydrates_serving || product.nutriments?.carbohydrates_100g || 0;
    const servingSizeText = product.serving_size || "";
    const parsedServing = parseFloat(servingSizeText);
    const servingUnit = servingSizeText.replace(parsedServing, "").trim();

    return {
      ...product,
      food_name: product.product_name_en || product.generic_name_en || product.product_name || product.generic_name || product.brands || "Unknown product",
      brand_name: product.brands,
      nf_calories: calories,
      serving_qty: parsedServing || null,
      serving_unit: servingUnit || "",
      nf_ingredient_statement: product.ingredients_text || product.ingredients_text_en,
      full_nutrients: [
        { attr_id: 203, value: proteins },
        { attr_id: 204, value: fat },
        { attr_id: 205, value: carbs },
      ],
    };
  };

  const fetchOpenFoodFactsProducts = async (query) => {
    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=20`,
        {
          headers: {
            "User-Agent": "UmmahWell/1.0 (support@ummahwell.example)",
          },
        }
      );
      const data = await res.json();
      if (!data.products || !Array.isArray(data.products)) return [];
      return data.products.map(mapOffProductToFood);
    } catch (error) {
      console.error("Open Food Facts search error:", error);
      return [];
    }
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    setLoading(true);

    const openFoodFactsFoods = await fetchOpenFoodFactsProducts(searchTerm);

    // --- HARAM INGREDIENT CHECK ---
    const haramIngredients = [
      "gelatin",
      "marshmallow",
      "rice krispies",
      "lard",
      "pork",
      "bacon",
      "ham",
      "rum",
      "beer",
      "wine",
      "ethanol",
      "vanilla extract",
      "carmine",
      "cochineal",
      "pepsin",
      "rennet",
      "shortening (animal)",
      "animal fat",
      "emulsifier (animal)",
      "enzymes (porcine)",
      "lipase (porcine)",
      "monoglycerides (animal)",
      "diglycerides (animal)"
    ];

    const isHaram = (food) => {
      const name = (food.food_name || "").toLowerCase();
      const brand = (food.brand_name || "").toLowerCase();
      // Check in food name or brand name
      if (food.brand_name) {
        if (food.nf_ingredient_statement) {
          const ingredientsStr = food.nf_ingredient_statement.toLowerCase();
          const foundHaram = haramIngredients.find(haram =>
            ingredientsStr.includes(haram));
          if (foundHaram) {
            return true;
          }
        } 
        else {
          console.log("No list");
        }
      }

      if (haramIngredients.some(ingredient =>
        name.includes(ingredient) || brand.includes(ingredient)
      )) {
        console.log(`Warning: ${food.food_name || food.name} contains haram ingredients.`);
        return true;
      } else {
        return false;
      }
    };

    const filteredOpenFoodFacts = openFoodFactsFoods.filter(food => !isHaram(food));

    setFoods(filteredOpenFoodFacts);
    setLoading(false);
  };

  const handleAdd = async (food) => {
    const companies = ["tim hortons", "tim horton's", "starbucks", "nestle", "coca cola", "pepsi", "kraft", "mondelez", "unilever", "procter & gamble", "general mills", "campbell's soup", "7up", "mcdonald's", "burger king", "kfc", "pizza hut", "domino's pizza", "sodastream"]; // Boycotted companies
    const meat = ["lamb", "beef", "chicken", "turkey", "duck", "goose", "rabbit", "goat"]; // All meats which MAY be haram

    // Use word boundary regex for robust matching
    const normalize = str => str.replace(/[^\w\s]/gi, '').toLowerCase();
    const foodBrand = food.brand_name ? normalize(food.brand_name) : "";
    const foodName = food.food_name ? normalize(food.food_name) : "";

    const isBoycotted = companies.some(company => {
      const normalizedCompany = normalize(company);
      console.log("Checking company:", normalizedCompany);
      const regex = new RegExp(`\\b${normalizedCompany}\\b`, 'i');
      return regex.test(foodBrand) || regex.test(foodName);
    });

    if (isBoycotted) {
      alert("Warning: This food is produced by a company on the boycott list.");
      console.log("Boycotted food detected:", foodBrand, foodName);
    } else {
      console.log("Food is not on the boycott list:", foodBrand, foodName);
    }

    if (food.brand_name)
    {
      if (!food.nf_ingredient_statement)
      {
        alert(`WARNING: ${food.food_name || food.name} MAY contain haram ingredients, please verify manually.`);
      }
      else
      {
        const ingredientsStr = food.nf_ingredient_statement.toLowerCase();
        const foundMeat = meat.find(meat =>
          ingredientsStr.includes(meat)
        );
        if (foundMeat) {
          alert(`WARNING: ${food.food_name || food.name} contains meat which may not be halal-certified.`);
        }
      }
    }
    
    setSelectedFood(food); // Open popup with selected food
    setServingSize("1"); // Reset serving size to "1"
  };

  const confirmAddFood = async () => {
    const servingNum = parseFloat(servingSize);
    if (!servingSize || isNaN(servingNum) || servingNum <= 0) {
      alert("Please enter a valid serving size.");
      return;
    }
    if (addFoodToDiary) addFoodToDiary(selectedFood);

    // Adjust macros based on the serving size
    const adjustedCalories = Math.round((selectedFood.nf_calories || 0) * servingNum);
    const protein = Math.round((selectedFood.full_nutrients?.find(n => n.attr_id === 203)?.value || 0) * servingNum); // Protein (attr_id: 203)
    const fat = Math.round((selectedFood.full_nutrients?.find(n => n.attr_id === 204)?.value || 0) * servingNum);    // Fat (attr_id: 204)
    const carbs = Math.round((selectedFood.full_nutrients?.find(n => n.attr_id === 205)?.value || 0) * servingNum);  // Carbs (attr_id: 205)

    // Add to Firestore for the user
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) {
        alert('You must be logged in to add food.');
        return;
      }
      await addDoc(
        collection(db, 'users', user.uid, 'foods'),
        {
          food_name: selectedFood.food_name,
          brand_name: selectedFood.brand_name,
          nf_calories: adjustedCalories,
          protein,
          fat,
          carbs,
          serving_size: servingNum,
          timestamp: serverTimestamp()
        }
      );
      setSelectedFood(null); // Close popup after adding
    } catch (error) {
      console.error('Error adding food to Firestore:', error);
      alert(error);
    }
  };

  const getCalories = (food) => {
    if (food.nf_calories) return Math.round(food.nf_calories * (parseFloat(servingSize) || 0));
    return "N/A";
  };

  const getServing = (food) => {
    if (food.serving_qty && food.serving_unit) {
      return `${food.serving_qty} ${food.serving_unit}`;
    }
    if (food.serving_unit) {
      return food.serving_unit;
    }
    return "";
  };

  // Helper to get macro value per serving
  const getMacro = (food, attrId) => {
    return Math.round((food.full_nutrients?.find(n => n.attr_id === attrId)?.value || 0) * (parseFloat(servingSize) || 0));
  };

  return (
    <div className="logfood-container">
      <div className="logfood-search">
        <input
          type="text"
          placeholder="Search for a halal food..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleSearch(); }}
        />
        <button onClick={handleSearch}>Search</button>
      </div>

      <h3 className="logfood-history-title">Halal Food List</h3>
      <div className="logfood-history-list">
        {loading ? (
          <div>Loading...</div>
        ) : foods.length === 0 ? (
          <div>No foods found.</div>
        ) : (
          foods.map((food, index) => (
            <div className="logfood-item" key={index}>
              <div>
                <strong>{food.food_name || food.name}</strong>
                <p>{food.brand_name || food.tag_name || ""}</p>
                <p>
                  <span>Calories: {getCalories(food)}</span>
                  <br />
                  <span>Serving: {getServing(food)}</span>
                </p>
              </div>
              <button className="logfood-add-btn" onClick={() => handleAdd(food)}>+</button>
            </div>
          ))
        )}
      </div>

      {selectedFood && (
        <div className="popup-overlay">
          <div className="popup-content">
            <h3>Log Food</h3>
            <p>
              <strong>{selectedFood.food_name || selectedFood.name}</strong>
            </p>
            {/* Serving size info */}
            <p>
              <strong>Serving Size:</strong>{" "}
              {selectedFood.serving_qty || 1} {selectedFood.serving_unit || ""}
              {selectedFood.serving_weight_grams
                ? ` (${selectedFood.serving_weight_grams}g)`
                : ""}
            </p>
            {/* Macronutrient circles */}
            <div style={{ display: "flex", justifyContent: "center", gap: 24, margin: "16px 0" }}>
              <MacroCircle
                label="Protein"
                value={getMacro(selectedFood, 203)}
                color="#4caf50"
                unit="g"
              />
              <MacroCircle
                label="Carbs"
                value={getMacro(selectedFood, 205)}
                color="#2196f3"
                unit="g"
              />
              <MacroCircle
                label="Fat"
                value={getMacro(selectedFood, 204)}
                color="#ff9800"
                unit="g"
              />
            </div>
            <p>Calories: {getCalories(selectedFood)}</p>
            <div>
              <label htmlFor="serving-size">Serving Size:</label>
              <input
                id="serving-size"
                type="number"
                min="0.1"
                step="0.1"
                value={servingSize}
                onChange={e => setServingSize(e.target.value)}
              />
            </div>
            <div className="popup-actions">
              <button onClick={() => setSelectedFood(null)}>Cancel</button>
              <button onClick={confirmAddFood}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper component for macro circles
function MacroCircle({ label, value, color, unit }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          width: 70,
          height: 70,
          borderRadius: "50%",
          background: "#f5f5f5",
          border: `3px solid ${color}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto",
          fontWeight: "bold",
          fontSize: 18,
          color: color,
        }}
      >
        {value}{unit}
      </div>
      <div style={{ marginTop: 6, fontSize: 14, color: "#333" }}>{label}</div>
    </div>
  );
}

export default LogFood;